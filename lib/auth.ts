import { db } from '@/db';
import { credits, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Apple from 'next-auth/providers/apple';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';

const isDev = process.env.NODE_ENV !== 'production';

const providers: Provider[] = [
  Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  }),
  Apple({
    clientId: process.env.AUTH_APPLE_ID,
    clientSecret: process.env.AUTH_APPLE_SECRET,
  }),
  GitHub({
    clientId: process.env.AUTH_GITHUB_ID,
    clientSecret: process.env.AUTH_GITHUB_SECRET,
  }),
];

// TODO: revert — temporarily enabled for prod testing
if (true) {
  providers.push(
    Credentials({
      name: 'Dev Login',
      credentials: {
        email: { label: 'Email', type: 'email' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        if (!email) return null;

        // Find or create user
        let user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (!user) {
          const [newUser] = await db
            .insert(users)
            .values({
              email,
              name: email.split('@')[0],
            })
            .returning();

          await db.insert(credits).values({
            userId: newUser.id,
            balance: 100,
            totalPurchased: 0,
            totalUsed: 0,
          });

          user = newUser;
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account: _account }) {
      if (!user.email) {
        return false;
      }

      // Check if user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, user.email),
      });

      if (!existingUser) {
        // Create new user
        const [newUser] = await db
          .insert(users)
          .values({
            email: user.email,
            name: user.name,
            image: user.image,
          })
          .returning();

        // Initialize credits for new user (give some starter credits)
        await db.insert(credits).values({
          userId: newUser.id,
          balance: 100, // Starter credits
          totalPurchased: 0,
          totalUsed: 0,
        });
      } else {
        // Update user info if changed
        await db
          .update(users)
          .set({
            name: user.name,
            image: user.image,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id));
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        // Fetch user from database to get our internal ID
        const dbUser = await db.query.users.findFirst({
          where: eq(users.email, user.email),
        });
        if (dbUser) {
          token.userId = dbUser.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
});
