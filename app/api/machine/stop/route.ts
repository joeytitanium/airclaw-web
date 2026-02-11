import { auth } from '@/lib/auth';
import { stopMachine } from '@/services/machine';
import { createApiResponse } from '@/utils/create-api-response';
import { logger } from '@/lib/logger';

const DOMAIN = '/api/machine/stop';

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    await stopMachine(session.user.id);

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
