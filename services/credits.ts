import { db } from '@/db';
import { credits, creditTransactions, usageLogs, messages } from '@/db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { logger } from '@/lib/logger';

// Pricing: credits per 1K tokens (adjust based on your costs + margin)
const CREDITS_PER_1K_INPUT_TOKENS = 1;
const CREDITS_PER_1K_OUTPUT_TOKENS = 3;

export function calculateCreditsUsed(
  inputTokens: number,
  outputTokens: number,
): number {
  return Math.ceil(
    (inputTokens / 1000) * CREDITS_PER_1K_INPUT_TOKENS +
      (outputTokens / 1000) * CREDITS_PER_1K_OUTPUT_TOKENS,
  );
}

export async function getCredits(userId: string): Promise<{
  balance: number;
  totalPurchased: number;
  totalUsed: number;
}> {
  let userCredits = await db.query.credits.findFirst({
    where: eq(credits.userId, userId),
  });

  // Create credits record if it doesn't exist
  if (!userCredits) {
    const [newCredits] = await db
      .insert(credits)
      .values({
        userId,
        balance: 0,
        totalPurchased: 0,
        totalUsed: 0,
      })
      .returning();
    userCredits = newCredits;
  }

  return {
    balance: userCredits.balance,
    totalPurchased: userCredits.totalPurchased,
    totalUsed: userCredits.totalUsed,
  };
}

export async function hasEnoughCredits(
  userId: string,
  requiredCredits = 1,
): Promise<boolean> {
  const { balance } = await getCredits(userId);
  return balance >= requiredCredits;
}

export async function deductCredits(
  userId: string,
  amount: number,
  description?: string,
): Promise<{ success: boolean; newBalance: number }> {
  const userCredits = await db.query.credits.findFirst({
    where: eq(credits.userId, userId),
  });

  if (!userCredits || userCredits.balance < amount) {
    return { success: false, newBalance: userCredits?.balance ?? 0 };
  }

  const newBalance = userCredits.balance - amount;

  await db
    .update(credits)
    .set({
      balance: newBalance,
      totalUsed: userCredits.totalUsed + amount,
      updatedAt: new Date(),
    })
    .where(eq(credits.userId, userId));

  // Log the transaction
  await db.insert(creditTransactions).values({
    userId,
    amount: -amount,
    type: 'usage',
    description,
  });

  return { success: true, newBalance };
}

export async function addCredits(
  userId: string,
  amount: number,
  type: 'purchase' | 'bonus' | 'refund',
  description?: string,
): Promise<{ newBalance: number }> {
  let userCredits = await db.query.credits.findFirst({
    where: eq(credits.userId, userId),
  });

  if (!userCredits) {
    const [newCredits] = await db
      .insert(credits)
      .values({
        userId,
        balance: amount,
        totalPurchased: type === 'purchase' ? amount : 0,
        totalUsed: 0,
      })
      .returning();
    userCredits = newCredits;
  } else {
    const newBalance = userCredits.balance + amount;
    const newTotalPurchased =
      type === 'purchase'
        ? userCredits.totalPurchased + amount
        : userCredits.totalPurchased;

    await db
      .update(credits)
      .set({
        balance: newBalance,
        totalPurchased: newTotalPurchased,
        updatedAt: new Date(),
      })
      .where(eq(credits.userId, userId));

    userCredits = { ...userCredits, balance: newBalance };
  }

  // Log the transaction
  await db.insert(creditTransactions).values({
    userId,
    amount,
    type,
    description,
  });

  return { newBalance: userCredits.balance };
}

export async function logUsage(params: {
  userId: string;
  messageId?: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}): Promise<{ creditsUsed: number }> {
  const creditsUsed = calculateCreditsUsed(params.inputTokens, params.outputTokens);

  await db.insert(usageLogs).values({
    userId: params.userId,
    messageId: params.messageId,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    creditsUsed,
    model: params.model,
  });

  // Deduct credits
  await deductCredits(
    params.userId,
    creditsUsed,
    `Usage: ${params.inputTokens} input + ${params.outputTokens} output tokens (${params.model})`,
  );

  return { creditsUsed };
}

export async function getCreditHistory(
  userId: string,
  limit = 50,
): Promise<Array<typeof creditTransactions.$inferSelect>> {
  return db.query.creditTransactions.findMany({
    where: eq(creditTransactions.userId, userId),
    orderBy: [desc(creditTransactions.createdAt)],
    limit,
  });
}

export async function getUsageStats(
  userId: string,
  days = 30,
): Promise<{
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCreditsUsed: number;
  messageCount: number;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const result = await db
    .select({
      totalInputTokens: sql<number>`COALESCE(SUM(${usageLogs.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${usageLogs.outputTokens}), 0)`,
      totalCreditsUsed: sql<number>`COALESCE(SUM(${usageLogs.creditsUsed}), 0)`,
      messageCount: sql<number>`COUNT(*)`,
    })
    .from(usageLogs)
    .where(
      sql`${usageLogs.userId} = ${userId} AND ${usageLogs.createdAt} >= ${since.toISOString()}`,
    );

  return {
    totalInputTokens: Number(result[0]?.totalInputTokens ?? 0),
    totalOutputTokens: Number(result[0]?.totalOutputTokens ?? 0),
    totalCreditsUsed: Number(result[0]?.totalCreditsUsed ?? 0),
    messageCount: Number(result[0]?.messageCount ?? 0),
  };
}
