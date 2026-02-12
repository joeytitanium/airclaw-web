import { db } from '@/db';
import { credits, users } from '@/db/schema';
import { signMobileJwt } from '@/lib/mobile-auth';
import { logger } from '@/lib/logger';
import { createApiResponse } from '@/utils/create-api-response';
import { eq } from 'drizzle-orm';

const DOMAIN = '/api/auth/mobile';

interface GoogleTokenInfo {
  email: string;
  email_verified: string;
  name?: string;
  picture?: string;
  sub: string;
}

async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleTokenInfo | null> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.email_verified !== 'true') return null;
  return data as GoogleTokenInfo;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { idToken, platform } = body;

    if (!idToken || typeof idToken !== 'string') {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Missing idToken',
      });
    }

    if (platform !== 'google') {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Unsupported platform',
      });
    }

    const tokenInfo = await verifyGoogleIdToken(idToken);
    if (!tokenInfo) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Invalid or expired token',
      });
    }

    const { email, name, picture } = tokenInfo;

    // Find or create user (same logic as NextAuth signIn callback)
    let user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({ email, name, image: picture })
        .returning();

      await db.insert(credits).values({
        userId: newUser.id,
        balance: 100,
        totalPurchased: 0,
        totalUsed: 0,
      });

      user = newUser;
    } else {
      await db
        .update(users)
        .set({ name, image: picture, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    const token = await signMobileJwt(user.id);

    return createApiResponse({
      code: '200-success',
      data: { token, userId: user.id },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Mobile auth error');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
