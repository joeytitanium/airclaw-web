import { logger } from '@/lib/logger';
import 'dotenv/config';
import next from 'next';
import { createServer } from 'node:http';
import { parse } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = Number.parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Store active WebSocket connections by user ID
const connections = new Map<string, Set<WebSocket>>();

interface WSMessage {
  type: 'message' | 'ping' | 'status';
  content?: string;
}

import type { WSResponse } from '@/types/ws';

app.prepare().then(async () => {
  // Dynamic imports — must load after app.prepare() so Next.js runtime is ready
  const { sendMessageStreaming } = await import('@/services/message');
  const { hasEnoughCredits } = await import('@/services/credits');
  const { getMachineStatus } = await import('@/services/machine');
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '/', true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      logger.error({ err }, 'Error handling request');
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  // Only handle our /ws path upgrades
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url ?? '/', true);

    // Only handle our explicit WebSocket path
    if (pathname !== '/ws') {
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (ws, request) => {
    const cookies = request.headers.cookie || '';
    const host = request.headers.host || 'localhost:3000';
    const protocol = dev ? 'http' : 'https';

    // Register close/error handlers IMMEDIATELY so we always see disconnects
    let userId: string | null = null;

    ws.on('close', (code, reason) => {
      logger.info(
        { userId, code, reason: reason.toString() },
        'WebSocket disconnected',
      );
      if (userId) {
        connections.get(userId)?.delete(ws);
        if (connections.get(userId)?.size === 0) {
          connections.delete(userId);
        }
      }
    });

    ws.on('error', (error) => {
      logger.error({ error, userId }, 'WebSocket error');
    });

    // Parse session token from cookies (handle both secure and non-secure prefixes)
    const sessionToken = cookies
      .split(';')
      .map((c) => c.trim())
      .find(
        (c) =>
          c.startsWith('authjs.session-token=') ||
          c.startsWith('__Secure-authjs.session-token='),
      )
      ?.replace(/^[^=]+=/, '');

    if (!sessionToken) {
      logger.warn(
        { cookieNames: cookies.split(';').map((c) => c.trim().split('=')[0]) },
        'WebSocket connection without session token',
      );
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Validate the session via a fetch to our own API
    try {
      const validateResponse = await fetch(`${protocol}://${host}/api/user`, {
        headers: {
          Cookie: cookies,
        },
      });

      if (validateResponse.ok) {
        const userData = await validateResponse.json();
        if (userData.success && userData.data?.id) {
          userId = userData.data.id;
        }
      } else {
        logger.warn(
          { status: validateResponse.status },
          'WebSocket session validation failed',
        );
      }
    } catch (error) {
      logger.error({ error }, 'Failed to validate WebSocket session');
    }

    if (!userId) {
      logger.warn('WebSocket closing: no userId after validation');
      ws.close(4001, 'Unauthorized');
      return;
    }

    logger.info({ userId }, 'WebSocket connected');

    // Add to connections map
    if (!connections.has(userId)) {
      connections.set(userId, new Set());
    }
    connections.get(userId)?.add(ws);

    // Set up message handler
    ws.on('message', async (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' } as WSResponse));
            break;

          case 'status': {
            const currentStatus = await getMachineStatus(userId as string);
            ws.send(
              JSON.stringify({
                type: 'status',
                status: currentStatus.status,
              } as WSResponse),
            );
            break;
          }

          case 'message': {
            if (!message.content) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  error: 'Message content required',
                } as WSResponse),
              );
              break;
            }

            // Check credits before processing
            if (!(await hasEnoughCredits(userId as string))) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  error: 'Insufficient credits',
                  errorCode: 'insufficient-credits',
                } as WSResponse),
              );
              break;
            }

            // Stream response from machine
            ws.send(JSON.stringify({ type: 'stream_start' } as WSResponse));

            const result = await sendMessageStreaming(
              userId as string,
              message.content,
              (chunk) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: 'stream_chunk',
                      content: chunk,
                    } as WSResponse),
                  );
                }
              },
            );

            if (result.success) {
              ws.send(
                JSON.stringify({
                  type: 'stream_end',
                  messageId: result.messageId,
                  creditsUsed: result.creditsUsed,
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                } as WSResponse),
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  error: result.error,
                  errorCode: result.errorCode,
                } as WSResponse),
              );
            }
            break;
          }

          default:
            ws.send(
              JSON.stringify({
                type: 'error',
                error: 'Unknown message type',
              } as WSResponse),
            );
        }
      } catch (error) {
        logger.error({ error }, 'Error handling WebSocket message');
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: 'Internal error',
            } as WSResponse),
          );
        }
      }
    });

    // Send initial status (after handlers are registered)
    try {
      const status = await getMachineStatus(userId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'status',
            status: status.status,
          } as WSResponse),
        );
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send initial status');
    }
  });

  server.listen(port, () => {
    logger.info(`> Ready on http://${hostname}:${port}`);
  });
});

// Helper to broadcast to all connections for a user
export function broadcastToUser(userId: string, message: WSResponse): void {
  const userConnections = connections.get(userId);
  if (userConnections) {
    const messageStr = JSON.stringify(message);
    for (const ws of userConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    }
  }
}
