import 'dotenv/config';
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '@/lib/logger';
import { auth } from '@/lib/auth';
import { sendMessage } from '@/services/message';
import { hasEnoughCredits } from '@/services/credits';
import { getMachineStatus } from '@/services/machine';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Store active WebSocket connections by user ID
const connections = new Map<string, Set<WebSocket>>();

interface WSMessage {
  type: 'message' | 'ping' | 'status';
  content?: string;
}

interface WSResponse {
  type: 'message' | 'pong' | 'status' | 'error';
  content?: string;
  messageId?: string;
  status?: string;
  error?: string;
  errorCode?: string;
}

async function authenticateWebSocket(
  request: Request,
): Promise<string | null> {
  try {
    // Extract session from cookie
    const session = await auth();
    return session?.user?.id ?? null;
  } catch (error) {
    logger.error({ error }, 'WebSocket authentication failed');
    return null;
  }
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      logger.error({ err }, 'Error handling request');
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', async (ws, request) => {
    // Create a minimal Request object for auth
    const cookies = request.headers.cookie || '';
    const host = request.headers.host || 'localhost:3000';
    const protocol = dev ? 'http' : 'https';

    // Parse session token from cookies
    const sessionToken = cookies
      .split(';')
      .find((c) => c.trim().startsWith('authjs.session-token='))
      ?.split('=')[1];

    if (!sessionToken) {
      logger.warn('WebSocket connection without session token');
      ws.close(4001, 'Unauthorized');
      return;
    }

    // For now, we'll validate the session via a quick fetch to our own API
    // This is a workaround since we can't directly use NextAuth's auth() in raw WS
    let userId: string | null = null;

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
      }
    } catch (error) {
      logger.error({ error }, 'Failed to validate WebSocket session');
    }

    if (!userId) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    logger.info({ userId }, 'WebSocket connected');

    // Add to connections map
    if (!connections.has(userId)) {
      connections.set(userId, new Set());
    }
    connections.get(userId)!.add(ws);

    // Send initial status
    const status = await getMachineStatus(userId);
    ws.send(
      JSON.stringify({
        type: 'status',
        status: status.status,
      } as WSResponse),
    );

    ws.on('message', async (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' } as WSResponse));
            break;

          case 'status':
            const currentStatus = await getMachineStatus(userId);
            ws.send(
              JSON.stringify({
                type: 'status',
                status: currentStatus.status,
              } as WSResponse),
            );
            break;

          case 'message':
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
            if (!(await hasEnoughCredits(userId))) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  error: 'Insufficient credits',
                  errorCode: 'insufficient-credits',
                } as WSResponse),
              );
              break;
            }

            // Send message and get response
            const result = await sendMessage(userId, message.content);

            if (result.success) {
              ws.send(
                JSON.stringify({
                  type: 'message',
                  content: result.response,
                  messageId: result.messageId,
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
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'Internal error',
          } as WSResponse),
        );
      }
    });

    ws.on('close', () => {
      logger.info({ userId }, 'WebSocket disconnected');
      connections.get(userId)?.delete(ws);
      if (connections.get(userId)?.size === 0) {
        connections.delete(userId);
      }
    });

    ws.on('error', (error) => {
      logger.error({ error, userId }, 'WebSocket error');
    });
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
