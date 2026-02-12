import { db } from '@/db';
import { usageLogs, users } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { clearMessageHistory, getMessageHistory } from '@/services/message';
import { createApiResponse } from '@/utils/create-api-response';
import { eq } from 'drizzle-orm';

const DOMAIN = '/api/messages';

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = Number.parseInt(url.searchParams.get('offset') || '0', 10);

    const messages = await getMessageHistory(session.userId, limit, offset);

    // Only fetch and include usage data for admin users
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    const isAdmin = user?.email === process.env.ADMIN_EMAIL;

    const usageMap = new Map<string, { creditsUsed: number; inputTokens: number; outputTokens: number }>();

    if (isAdmin) {
      const logs = await db.query.usageLogs.findMany({
        where: eq(usageLogs.userId, session.userId),
      });
      for (const log of logs) {
        if (log.messageId) {
          usageMap.set(log.messageId, {
            creditsUsed: log.creditsUsed,
            inputTokens: log.inputTokens,
            outputTokens: log.outputTokens,
          });
        }
      }
    }

    return createApiResponse({
      code: '200-success',
      data: {
        messages: messages.map((m) => {
          const usage = usageMap.get(m.id);
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            ...(usage && { creditsUsed: usage.creditsUsed, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }),
          };
        }),
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error fetching messages');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    await clearMessageHistory(session.userId);

    return createApiResponse({
      code: '200-success',
      data: { cleared: true },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error clearing messages');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
