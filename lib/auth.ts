import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Apple from 'next-auth/providers/apple';
import GitHub from 'next-auth/providers/github';
import { db } from '@/db';
import { users, credits } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
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
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account }) {
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
