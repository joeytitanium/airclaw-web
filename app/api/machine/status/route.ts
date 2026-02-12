import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getMachineStatus } from '@/services/machine';
import { createApiResponse } from '@/utils/create-api-response';

const DOMAIN = '/api/machine/status';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const status = await getMachineStatus(session.user.id);

    return createApiResponse({
      code: '200-success',
      data: status,
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error getting machine status');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
