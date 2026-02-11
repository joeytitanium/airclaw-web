import { auth } from '@/lib/auth';
import { getMessageHistory, clearMessageHistory } from '@/services/message';
import { createApiResponse } from '@/utils/create-api-response';
import { logger } from '@/lib/logger';

const DOMAIN = '/api/messages';

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const messages = await getMessageHistory(session.user.id, limit, offset);

    return createApiResponse({
      code: '200-success',
      data: {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
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
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    await clearMessageHistory(session.user.id);

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
