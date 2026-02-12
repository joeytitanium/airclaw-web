import { getSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getIntegrations } from '@/services/integrations';
import { createApiResponse } from '@/utils/create-api-response';

const DOMAIN = '/api/integrations';

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const integrations = await getIntegrations(session.userId);

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
