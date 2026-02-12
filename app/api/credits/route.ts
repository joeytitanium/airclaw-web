import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getCredits, getUsageStats } from '@/services/credits';
import { createApiResponse } from '@/utils/create-api-response';

const DOMAIN = '/api/credits';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const credits = await getCredits(session.user.id);
    const usageStats = await getUsageStats(session.user.id);

    return createApiResponse({
      code: '200-success',
      data: {
        ...credits,
        usage: usageStats,
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error fetching credits');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
