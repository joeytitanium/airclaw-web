import { getSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { stopMachine } from '@/services/machine';
import { createApiResponse } from '@/utils/create-api-response';

const DOMAIN = '/api/machine/stop';

export async function POST() {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    await stopMachine(session.userId);

    return createApiResponse({
      code: '200-success',
      data: { stopped: true },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error stopping machine');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'Failed to stop machine',
      internalErrorCode: 'machine-error',
    });
  }
}
