import { getSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getCreditHistory } from '@/services/credits';
import { createApiResponse } from '@/utils/create-api-response';

const DOMAIN = '/api/credits/history';

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

    const history = await getCreditHistory(session.userId, limit);

    return createApiResponse({
      code: '200-success',
      data: {
        transactions: history.map((t) => ({
          id: t.id,
          amount: t.amount,
          type: t.type,
          description: t.description,
          createdAt: t.createdAt,
        })),
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error fetching credit history');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
