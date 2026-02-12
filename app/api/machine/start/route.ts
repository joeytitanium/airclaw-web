import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { startMachine } from '@/services/machine';
import { createApiResponse } from '@/utils/create-api-response';

const DOMAIN = '/api/machine/start';

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const { machine, flyMachine } = await startMachine(session.user.id);

    return createApiResponse({
      code: '200-success',
      data: {
        status: machine.status,
        machineId: machine.machineId,
        privateIp: flyMachine.private_ip,
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error starting machine');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'Failed to start machine',
      internalErrorCode: 'machine-error',
    });
  }
}
