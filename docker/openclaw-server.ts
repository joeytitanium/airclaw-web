import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const PORT = 8080;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const USER_ID = process.env.USER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

interface MessageContext {
  recentMessages: Array<{ role: string; content: string }>;
  memories: Array<{ key: string; value: string }>;
  integrations: Array<{ type: string; enabled: boolean }>;
}

interface MessageRequest {
  content: string;
  context: MessageContext;
}

interface MessageResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// In-memory state (reloaded on startup from backend)
let memories: Map<string, string> = new Map();
let integrations: Map<string, boolean> = new Map();

async function syncWithBackend(): Promise<void> {
  if (!BACKEND_URL || !USER_ID) return;

  try {
    const response = await fetch(`${BACKEND_URL}/api/internal/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Machine-Secret': process.env.MACHINE_SECRET || '',
      },
      body: JSON.stringify({ userId: USER_ID }),
    });

    if (response.ok) {
      const data = await response.json();
      memories = new Map(data.memories?.map((m: { key: string; value: string }) => [m.key, m.value]) || []);
      integrations = new Map(data.integrations?.map((i: { type: string; enabled: boolean }) => [i.type, i.enabled]) || []);
      console.log('Synced with backend');
    }
  } catch (error) {
    console.error('Failed to sync with backend:', error);
  }
}

async function handleMessage(req: MessageRequest): Promise<MessageResponse> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // Build system prompt with memories
  let systemPrompt = 'You are a helpful AI assistant.';
  if (memories.size > 0) {
    systemPrompt += '\n\nUser preferences and memories:\n';
    for (const [key, value] of memories) {
      systemPrompt += `- ${key}: ${value}\n`;
    }
  }

  // Build messages array
  const messages = req.context.recentMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Add current message
  messages.push({
    role: 'user',
    content: req.content,
  });

  // Call Anthropic API
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const data = await response.json();

  return {
    content: data.content[0]?.text || '',
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
    model: data.model || 'claude-3-5-sonnet-20241022',
  };
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    switch (url.pathname) {
      case '/health':
        sendJson(res, 200, { status: 'ok', userId: USER_ID });
        break;

      case '/message':
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        const messageReq = (await parseBody(req)) as MessageRequest;
        const messageRes = await handleMessage(messageReq);
        sendJson(res, 200, messageRes);
        break;

      case '/sync':
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        await syncWithBackend();
        sendJson(res, 200, { synced: true });
        break;

      default:
        sendJson(res, 404, { error: 'Not found' });
    }
  } catch (error) {
    console.error('Request error:', error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

// Sync on startup
syncWithBackend().then(() => {
  server.listen(PORT, () => {
    console.log(`OpenClaw server running on port ${PORT}`);
    console.log(`User ID: ${USER_ID}`);
  });
});
