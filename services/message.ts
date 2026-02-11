import { db } from '@/db';
import { messages, memories, integrations } from '@/db/schema';
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

    // Get context to send to machine
    const context = await getMessageContext(userId);

    // Send message to machine
    const machineResponse = await sendToMachine(
      flyMachine.private_ip,
      content,
      context,
    );

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
    logger.error({ error, userId }, 'Failed to send message to machine');
    return {
      success: false,
      error: 'Failed to process message',
      errorCode: 'machine-error',
    };
  }
}

async function sendToMachine(
  privateIp: string,
  content: string,
  context: MessageContext,
): Promise<MachineResponse> {
  const response = await fetch(`http://${privateIp}:8080/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      context,
    }),
  });

  if (!response.ok) {
    throw new Error(`Machine returned ${response.status}`);
  }

  return response.json();
}

interface MessageContext {
  recentMessages: Array<{ role: string; content: string }>;
  memories: Array<{ key: string; value: string }>;
  integrations: Array<{ type: string; enabled: boolean }>;
}

async function getMessageContext(userId: string): Promise<MessageContext> {
  // Get recent messages for context
  const recentMessages = await db.query.messages.findMany({
    where: eq(messages.userId, userId),
    orderBy: [desc(messages.createdAt)],
    limit: 20, // Last 20 messages for context
  });

  // Get user's memories
  const userMemories = await db.query.memories.findMany({
    where: eq(memories.userId, userId),
  });

  // Get user's integrations
  const userIntegrations = await db.query.integrations.findMany({
    where: eq(integrations.userId, userId),
  });

  return {
    recentMessages: recentMessages
      .reverse()
      .map((m) => ({ role: m.role, content: m.content })),
    memories: userMemories.map((m) => ({ key: m.key, value: m.value })),
    integrations: userIntegrations.map((i) => ({
      type: i.type,
      enabled: i.enabled,
    })),
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
