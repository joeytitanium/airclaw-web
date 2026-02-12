import { db } from '@/db';
import { messages } from '@/db/schema';
import { logger } from '@/lib/logger';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { asc, desc, eq } from 'drizzle-orm';
import { hasEnoughCredits, logUsage } from './credits';
import { startMachine } from './machine';

interface SendMessageResult {
  success: boolean;
  response?: string;
  messageId?: string;
  creditsUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
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
  const [_userMessage] = await db
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
    const chatMessages = recentMessages.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
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
    const { creditsUsed } = await logUsage({
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
      creditsUsed,
      inputTokens: machineResponse.inputTokens,
      outputTokens: machineResponse.outputTokens,
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

interface StreamingResult {
  success: boolean;
  messageId?: string;
  creditsUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  errorCode?: 'insufficient-credits' | 'machine-error' | 'internal-error';
}

export async function sendMessageStreaming(
  userId: string,
  content: string,
  onChunk: (text: string) => void,
): Promise<StreamingResult> {
  if (!(await hasEnoughCredits(userId))) {
    return {
      success: false,
      error: 'Insufficient credits',
      errorCode: 'insufficient-credits',
    };
  }

  // Save user message
  await db.insert(messages).values({ userId, role: 'user', content });

  try {
    const { flyMachine } = await startMachine(userId);

    // Build conversation history
    const recentMessages = await db.query.messages.findMany({
      where: eq(messages.userId, userId),
      orderBy: [desc(messages.createdAt)],
      limit: 20,
    });
    const chatMessages = recentMessages.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    chatMessages.push({ role: 'user', content });

    // Stream from OpenClaw via AI SDK with retry for 502 during gateway boot
    const maxRetries = 12;
    const retryDelayMs = 5000;
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const openai = createOpenAI({
          baseURL: `https://${FLY_APP_NAME}.fly.dev/v1`,
          apiKey: MACHINE_SECRET,
          headers: { 'fly-force-instance-id': flyMachine.id },
        });

        const result = streamText({
          model: openai.chat('openclaw:main'),
          messages: chatMessages,
          maxRetries: 0,
        });

        for await (const chunk of result.textStream) {
          fullText += chunk;
          onChunk(chunk);
        }

        const usage = await result.usage;
        inputTokens = usage.inputTokens ?? 0;
        outputTokens = usage.outputTokens ?? 0;
        break; // Success — exit retry loop
      } catch (err) {
        const errStr = String(err);
        const isRetryable =
          errStr.includes('502') || errStr.includes('No output generated');
        if (isRetryable && attempt < maxRetries) {
          logger.info(
            { machineId: flyMachine.id, attempt: attempt + 1, maxRetries },
            'Machine gateway not ready, retrying',
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          fullText = '';
          continue;
        }
        throw err;
      }
    }

    // Save assistant message
    const [assistantMessage] = await db
      .insert(messages)
      .values({ userId, role: 'assistant', content: fullText })
      .returning();

    // Log usage and deduct credits
    const { creditsUsed } = await logUsage({
      userId,
      messageId: assistantMessage.id,
      inputTokens,
      outputTokens,
      model: 'openclaw:main',
    });

    return {
      success: true,
      messageId: assistantMessage.id,
      creditsUsed,
      inputTokens,
      outputTokens,
    };
  } catch (error) {
    logger.error(
      { err: error, userId },
      'Failed to stream message from machine',
    );
    return {
      success: false,
      error: 'Failed to process message',
      errorCode: 'machine-error',
    };
  }
}

const FLY_APP_NAME = process.env.FLY_APP_NAME || 'airclaw-dev';
const MACHINE_SECRET = process.env.MACHINE_SECRET || '';

async function sendToMachine(
  machineId: string,
  chatMessages: Array<{ role: string; content: string }>,
): Promise<MachineResponse> {
  const url = `https://${FLY_APP_NAME}.fly.dev/v1/chat/completions`;
  const maxRetries = 12;
  const retryDelayMs = 5000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MACHINE_SECRET}`,
        'fly-force-instance-id': machineId,
      },
      body: JSON.stringify({
        model: 'openclaw:main',
        messages: chatMessages,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        content: data.choices?.[0]?.message?.content || '',
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        model: data.model || 'openclaw',
      };
    }

    // Retry on 502 (gateway not ready) — the OpenClaw gateway takes ~40s to boot
    if (response.status === 502 && attempt < maxRetries) {
      logger.info(
        { machineId, attempt: attempt + 1, maxRetries },
        'Machine gateway not ready, retrying',
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    const body = await response.text();
    throw new Error(`Machine returned ${response.status}: ${body}`);
  }

  throw new Error('Unreachable');
}

export async function getMessageHistory(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<Array<typeof messages.$inferSelect>> {
  return db.query.messages.findMany({
    where: eq(messages.userId, userId),
    orderBy: [asc(messages.createdAt)],
    limit,
    offset,
  });
}

export async function clearMessageHistory(userId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.userId, userId));
}
