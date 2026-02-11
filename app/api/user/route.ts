import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createApiResponse } from '@/utils/create-api-response';
import { logger } from '@/lib/logger';

const DOMAIN = '/api/user';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });

    if (!user) {
      return createApiResponse({
        code: '404-not-found',
        publicFacingMessage: 'User not found',
      });
    }

    return createApiResponse({
      code: '200-success',
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error fetching user');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
