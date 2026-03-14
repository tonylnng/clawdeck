import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { redactMiddleware } from '../middleware/redact';
import fetch from 'node-fetch';

const router = Router();

router.use(requireAuth);
router.use(redactMiddleware);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

async function invokeGatewayTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ tool, args }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  return res.json();
}

interface RawMessage {
  id?: string;
  role?: string;
  content?: string | { text?: string };
  text?: string;
  timestamp?: number | string;
  createdAt?: number | string;
  updatedAt?: number | string;
}

interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  source?: string;
}

function normalizeMessages(raw: unknown, sessionKey?: string): NormalizedMessage[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((msg: RawMessage, idx: number) => {
    const role: 'user' | 'assistant' =
      msg.role === 'user' || msg.role === 'assistant' ? msg.role : 'assistant';

    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (typeof msg.content === 'object' && msg.content !== null) {
      content = msg.content.text || JSON.stringify(msg.content);
    } else if (typeof msg.text === 'string') {
      content = msg.text;
    }

    const ts = msg.timestamp || msg.createdAt || msg.updatedAt;
    let timestamp: string;
    if (typeof ts === 'number') {
      timestamp = new Date(ts).toISOString();
    } else if (typeof ts === 'string') {
      timestamp = ts;
    } else {
      timestamp = new Date().toISOString();
    }

    // Derive channel badge from session key e.g. agent:main:telegram:xyz -> telegram
    let source: string | undefined;
    if (sessionKey) {
      const parts = sessionKey.split(':');
      if (parts.length >= 3) {
        source = parts[2];
      }
    }

    return {
      id: msg.id || `msg-${idx}-${Date.now()}`,
      role,
      content,
      timestamp,
      source,
    };
  });
}

// GET /api/sessions - list all sessions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const raw = await invokeGatewayTool('sessions_list', {}) as {
      result?: { details?: { sessions?: SessionEntry[] }; sessions?: SessionEntry[] };
    };

    interface SessionEntry {
      key: string;
      model?: string;
      channel?: string;
      updatedAt?: number;
      createdAt?: number;
    }

    const sessions: SessionEntry[] =
      raw?.result?.details?.sessions ??
      (raw?.result as { sessions?: SessionEntry[] })?.sessions ??
      [];

    const normalized = sessions.map((s: SessionEntry) => ({
      key: s.key,
      model: s.model,
      channel: s.channel,
      updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
      createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
      // Derive display label from key: agent:main:telegram:... -> "main / telegram"
      label: (() => {
        const parts = s.key.split(':');
        if (parts[0] === 'agent' && parts.length >= 3) {
          return `${parts[1]} / ${parts[2]}`;
        }
        return s.key;
      })(),
    }));

    res.json({ sessions: normalized });
  } catch (err) {
    console.error('Failed to list sessions:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// GET /api/sessions/:key/history?limit=50
router.get('/:key(*)/history', async (req: Request, res: Response) => {
  const key = req.params.key;
  const limit = parseInt(req.query.limit as string || '50', 10);

  try {
    const result = await invokeGatewayTool('sessions_history', {
      sessionKey: key,
      limit,
    }) as { result?: { messages?: unknown[]; history?: unknown[] } | unknown[] };

    // Normalize messages from various possible shapes
    let rawMessages: unknown = [];
    if (Array.isArray(result)) {
      rawMessages = result;
    } else if (result?.result) {
      const r = result.result as { messages?: unknown[]; history?: unknown[] };
      rawMessages = r?.messages ?? r?.history ?? result.result;
    }

    const messages = normalizeMessages(rawMessages, key);
    res.json({ messages, sessionKey: key });
  } catch (err) {
    console.error('Failed to get session history:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// POST /api/sessions/:key/send - send a message to a session
router.post('/:key(*)/send', async (req: Request, res: Response) => {
  const key = req.params.key;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const result = await invokeGatewayTool('sessions_send', {
      sessionKey: key,
      message,
    });

    res.json({ ok: true, result });
  } catch (err) {
    console.error('Failed to send session message:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// GET /api/sessions/:key/poll?since=<timestamp> - poll for new messages
router.get('/:key(*)/poll', async (req: Request, res: Response) => {
  const key = req.params.key;
  const since = req.query.since as string | undefined;
  const limit = parseInt(req.query.limit as string || '50', 10);

  try {
    const result = await invokeGatewayTool('sessions_history', {
      sessionKey: key,
      limit,
    }) as { result?: { messages?: unknown[]; history?: unknown[] } | unknown[] };

    let rawMessages: unknown = [];
    if (Array.isArray(result)) {
      rawMessages = result;
    } else if (result?.result) {
      const r = result.result as { messages?: unknown[]; history?: unknown[] };
      rawMessages = r?.messages ?? r?.history ?? result.result;
    }

    let messages = normalizeMessages(rawMessages, key);

    // Filter by since timestamp if provided
    if (since) {
      const sinceDate = new Date(since).getTime();
      if (!isNaN(sinceDate)) {
        messages = messages.filter((m) => {
          const mTime = new Date(m.timestamp).getTime();
          return mTime > sinceDate;
        });
      }
    }

    res.json({ messages, sessionKey: key });
  } catch (err) {
    console.error('Failed to poll session:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

export default router;
