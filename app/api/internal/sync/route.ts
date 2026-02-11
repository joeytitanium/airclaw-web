import { db } from '@/db';
import { memories, integrations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createApiResponse } from '@/utils/create-api-response';
import { logger } from '@/lib/logger';
import { decrypt } from '@/lib/encryption';
import { z } from 'zod';

const DOMAIN = '/api/internal/sync';

const SYNC_SCHEMA = z.object({
  userId: z.string(),
});

// Internal endpoint called by OpenClaw machines to sync state
export async function POST(request: Request) {
  try {
    // Verify machine secret
    const machineSecret = request.headers.get('x-machine-secret');
    if (machineSecret !== process.env.MACHINE_SECRET) {
      return createApiResponse({
        code: '403-forbidden',
        publicFacingMessage: 'Invalid machine secret',
      });
    }

    const body = await request.json();
    const parsed = SYNC_SCHEMA.safeParse(body);

    if (!parsed.success) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid request body',
      });
    }

    const { userId } = parsed.data;

    // Get user's memories
    const userMemories = await db.query.memories.findMany({
      where: eq(memories.userId, userId),
    });

    // Get user's integrations with decrypted credentials
    const userIntegrations = await db.query.integrations.findMany({
      where: eq(integrations.userId, userId),
    });

    const decryptedIntegrations = userIntegrations.map((i) => {
      try {
        return {
          type: i.type,
          enabled: i.enabled,
          credentials: i.enabled ? JSON.parse(decrypt(i.credentials)) : null,
        };
      } catch {
        return {
          type: i.type,
          enabled: false,
          credentials: null,
        };
      }
    });

    return createApiResponse({
      code: '200-success',
      data: {
        memories: userMemories.map((m) => ({ key: m.key, value: m.value })),
        integrations: decryptedIntegrations,
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error syncing machine state');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
