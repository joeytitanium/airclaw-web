import { auth } from '@/lib/auth';
import { getIntegrations } from '@/services/integrations';
import { createApiResponse } from '@/utils/create-api-response';
import { logger } from '@/lib/logger';

const DOMAIN = '/api/integrations';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const integrations = await getIntegrations(session.user.id);

    return createApiResponse({
      code: '200-success',
      data: { integrations },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error fetching integrations');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
