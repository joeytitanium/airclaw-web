import { db } from '@/db';
import { messages } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { startMachine, getMachineStatus } from './machine';
import { hasEnoughCredits, logUsage } from './credits';
import { logger } from '@/lib/logger';

interface SendMessageResult {
  success: boolean;
  response?: string;
  messageId?: string;
  error?: string;
  errorCode?: 'insufficient-credits' | 'machine-error' | 'internal-error';
}

interface MachineResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export async function sendMessage(
  userId: string,
  content: string,
): Promise<SendMessageResult> {
  // Check credits first
  if (!(await hasEnoughCredits(userId))) {
    return {
      success: false,
      error: 'Insufficient credits',
      errorCode: 'insufficient-credits',
    };
  }

  // Save user message
  const [userMessage] = await db
    .insert(messages)
    .values({
      userId,
      role: 'user',
      content,
    })
    .returning();

  try {
    // Start/get machine
    const { flyMachine } = await startMachine(userId);

    // Build conversation history for OpenClaw
    const recentMessages = await db.query.messages.findMany({
      where: eq(messages.userId, userId),
      orderBy: [desc(messages.createdAt)],
      limit: 20,
    });
    const chatMessages = recentMessages
      .reverse()
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    chatMessages.push({ role: 'user', content });

    // Send to OpenClaw gateway
    const machineResponse = await sendToMachine(flyMachine.id, chatMessages);

    // Save assistant message
    const [assistantMessage] = await db
      .insert(messages)
      .values({
        userId,
        role: 'assistant',
        content: machineResponse.content,
      })
      .returning();

    // Log usage and deduct credits
    await logUsage({
      userId,
      messageId: assistantMessage.id,
      inputTokens: machineResponse.inputTokens,
      outputTokens: machineResponse.outputTokens,
      model: machineResponse.model,
    });

    return {
      success: true,
      response: machineResponse.content,
      messageId: assistantMessage.id,
    };
  } catch (error) {
    logger.error({ err: error, userId }, 'Failed to send message to machine');
    return {
      success: false,
      error: 'Failed to process message',
      errorCode: 'machine-error',
    };
  }
}

const FLY_APP_NAME = process.env.FLY_APP_NAME || 'pocketclaw-openclaw';
const MACHINE_SECRET = process.env.MACHINE_SECRET || '';

async function sendToMachine(
  machineId: string,
  chatMessages: Array<{ role: string; content: string }>,
): Promise<MachineResponse> {
  const url = `https://${FLY_APP_NAME}.fly.dev/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MACHINE_SECRET}`,
      'fly-force-instance-id': machineId,
    },
    body: JSON.stringify({
      model: 'openclaw:main',
      messages: chatMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Machine returned ${response.status}: ${body}`);
  }

  const data = await response.json();

  return {
    content: data.choices?.[0]?.message?.content || '',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
    model: data.model || 'openclaw',
  };
}

export async function getMessageHistory(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<Array<typeof messages.$inferSelect>> {
  return db.query.messages.findMany({
    where: eq(messages.userId, userId),
    orderBy: [desc(messages.createdAt)],
    limit,
    offset,
  });
}

export async function clearMessageHistory(userId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.userId, userId));
}
