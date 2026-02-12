import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { upgradeMachine } from '@/services/machine';
import { createApiResponse } from '@/utils/create-api-response';

const DOMAIN = '/api/machine/upgrade';

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    await upgradeMachine(session.user.id);

    return createApiResponse({
      code: '200-success',
      data: {
        upgraded: true,
        message: 'Machine will start with latest version on next use',
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error upgrading machine');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'Failed to upgrade machine',
      internalErrorCode: 'machine-error',
    });
  }
}
