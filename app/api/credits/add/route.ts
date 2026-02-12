import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { addCredits } from '@/services/credits';
import { createApiResponse } from '@/utils/create-api-response';
import { z } from 'zod';

const DOMAIN = '/api/credits/add';

const ADD_CREDITS_SCHEMA = z.object({
  amount: z.number().positive(),
  type: z.enum(['purchase', 'bonus', 'refund']),
  description: z.string().optional(),
});

// This endpoint should be called by billing webhooks (e.g., Stripe)
// In production, add webhook signature verification
export async function POST(request: Request) {
  try {
    // For webhook calls, we need to get userId from the body
    // For admin calls, we can use session
    const session = await auth();
    const body = await request.json();

    // Check for webhook secret or admin session
    const webhookSecret = request.headers.get('x-webhook-secret');
    const isWebhook = webhookSecret === process.env.WEBHOOK_SECRET;
    const isAdmin = session?.user?.email === process.env.ADMIN_EMAIL;

    if (!isWebhook && !isAdmin) {
      return createApiResponse({
        code: '403-forbidden',
        publicFacingMessage: 'Not authorized',
      });
    }

    const parsed = ADD_CREDITS_SCHEMA.extend({
      userId: z.string(),
    }).safeParse(body);

    if (!parsed.success) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid request body',
      });
    }

    const { userId, amount, type, description } = parsed.data;

    const result = await addCredits(userId, amount, type, description);

    logger.info({ userId, amount, type, domain: DOMAIN }, 'Credits added');

    return createApiResponse({
      code: '200-success',
      data: { newBalance: result.newBalance },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error adding credits');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
