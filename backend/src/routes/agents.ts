import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { redactMiddleware, redactObject, redactString } from '../middleware/redact';

const router = Router();

router.use(requireAuth);
router.use(redactMiddleware);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Multer config: memory storage, size limits per file type
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max (enforced per-file below)
  },
  fileFilter(_req, file, cb) {
    const allowed = [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/json',
    ];
    // Also allow by extension for files where mimetype may be generic
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const allowedExts = ['jpg', 'jpeg', 'png', 'pdf', 'txt', 'md', 'json'];

    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

async function invokeGatewayTool(tool: string, args: Record<string, unknown> = {}, sessionKey?: string): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ tool, args, ...(sessionKey ? { sessionKey } : {}) }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  return res.json();
}

// GET /api/agents - list all agents (deduplicated by agentId)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const raw = await invokeGatewayTool('sessions_list', {}) as {
      result?: { details?: { sessions?: SessionEntry[] }; content?: unknown[] }
    };

    interface SessionEntry {
      key: string;
      model?: string;
      channel?: string;
      updatedAt?: number;
    }

    const sessions: SessionEntry[] = raw?.result?.details?.sessions ?? [];

    // Extract unique agents from session keys (format: agent:<agentId>:<rest>)
    const agentMap = new Map<string, {
      id: string;
      name: string;
      model?: string;
      channel?: string;
      lastActive?: string;
      status: string;
    }>();

    for (const session of sessions) {
      const parts = session.key.split(':');
      if (parts[0] !== 'agent' || !parts[1]) continue;
      const agentId = parts[1];
      if (!agentMap.has(agentId)) {
        agentMap.set(agentId, {
          id: agentId,
          name: agentId,
          model: session.model,
          channel: session.channel !== 'unknown' ? session.channel : undefined,
          lastActive: session.updatedAt ? new Date(session.updatedAt).toISOString() : undefined,
          status: 'active',
        });
      }
    }

    res.json({ agents: Array.from(agentMap.values()) });
  } catch (err) {
    console.error('Failed to list agents:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// GET /api/agents/:id/history - get chat history for an agent
router.get('/:id/history', async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit as string || '50', 10);

  try {
    const result = await invokeGatewayTool('sessions_history', { sessionKey: id, limit }, id) as { result?: unknown };
    res.json(result);
  } catch (err) {
    console.error('Failed to get history:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// POST /api/agents/:id/chat - proxy SSE chat completions
router.post('/:id/chat', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { messages, model } = req.body;

  const body = {
    model: model || 'default',
    stream: true,
    messages: messages || [],
    session: id,
  };

  try {
    const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: 'Gateway error', detail: redactString(text) });
      return;
    }

    // SSE passthrough
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (!upstream.body) {
      res.end();
      return;
    }

    upstream.body.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const redacted = redactString(text);
      res.write(redacted);
    });

    upstream.body.on('end', () => {
      res.end();
    });

    upstream.body.on('error', (err: Error) => {
      console.error('Stream error:', err);
      res.end();
    });

    req.on('close', () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (upstream.body as any)?.destroy?.();
      } catch { /* ignore */ }
    });

  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(502).json({ error: 'Failed to reach gateway' });
  }
});

// POST /api/agents/:id/chat/rich - multipart/form-data with optional image or file
// Accepts: text (required), file (optional: image/*, .pdf, .txt, .md, .json)
router.post('/:id/chat/rich', upload.single('file'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const text = req.body.text || '';
  const model = req.body.model || 'default';
  const file = req.file;

  // Validate file size constraints
  if (file) {
    const isImage = ['image/jpeg', 'image/png'].includes(file.mimetype) ||
      ['jpg', 'jpeg', 'png'].includes((file.originalname.split('.').pop() || '').toLowerCase());
    const maxSize = isImage ? 10 * 1024 * 1024 : 5 * 1024 * 1024;

    if (file.size > maxSize) {
      res.status(413).json({
        error: `File too large. Max size: ${isImage ? '10MB' : '5MB'}`,
      });
      return;
    }
  }

  // Build message content — OpenClaw /v1/responses style
  // Content can be string or array of content parts (text + image_url)
  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'file'; file: { filename: string; content: string; mime_type: string } };

  let content: string | ContentPart[];

  if (file) {
    const parts: ContentPart[] = [];

    if (text) {
      parts.push({ type: 'text', text });
    }

    const isImage = ['image/jpeg', 'image/png'].includes(file.mimetype) ||
      ['jpg', 'jpeg', 'png'].includes((file.originalname.split('.').pop() || '').toLowerCase());

    if (isImage) {
      // Encode as base64 data URL for image_url content part
      const base64 = file.buffer.toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64}` },
      });
    } else {
      // Text-based file: embed as text content
      const fileText = file.buffer.toString('utf-8');
      parts.push({
        type: 'file',
        file: {
          filename: file.originalname,
          content: fileText,
          mime_type: file.mimetype,
        },
      });
    }

    content = parts;
  } else {
    content = text;
  }

  const messages = [{ role: 'user', content }];

  const body = {
    model,
    stream: true,
    messages,
    session: id,
  };

  try {
    const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(upstream.status).json({ error: 'Gateway error', detail: redactString(errText) });
      return;
    }

    // SSE passthrough
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (!upstream.body) {
      res.end();
      return;
    }

    upstream.body.on('data', (chunk: Buffer) => {
      const chunkText = chunk.toString('utf-8');
      const redacted = redactString(chunkText);
      res.write(redacted);
    });

    upstream.body.on('end', () => res.end());

    upstream.body.on('error', (err: Error) => {
      console.error('Rich stream error:', err);
      res.end();
    });

    req.on('close', () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (upstream.body as any)?.destroy?.();
      } catch { /* ignore */ }
    });

  } catch (err) {
    console.error('Rich chat proxy error:', err);
    res.status(502).json({ error: 'Failed to reach gateway' });
  }
});

export default router;
