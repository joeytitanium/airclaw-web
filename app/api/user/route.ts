import { db } from '@/db';
import { users } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { createApiResponse } from '@/utils/create-api-response';
import { eq } from 'drizzle-orm';

const DOMAIN = '/api/user';

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
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
        isAdmin: user.email === process.env.ADMIN_EMAIL,
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
