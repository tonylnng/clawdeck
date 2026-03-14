import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';
import { redactMiddleware } from '../middleware/redact';

const router = Router();

router.use(requireAuth);
router.use(redactMiddleware);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaygroundRunBody {
  agentId?: string;
  prompt: string;
  model?: string;
  systemPrompt?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  model?: string;
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

// POST /api/playground/run
router.post('/run', async (req: Request, res: Response) => {
  const { agentId, prompt, model, systemPrompt } = req.body as PlaygroundRunBody;

  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const messages: Array<{ role: string; content: string }> = [];

  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }

  messages.push({ role: 'user', content: prompt.trim() });

  const body = {
    model: model || 'default',
    stream: false,
    messages,
    ...(agentId ? { session: agentId } : {}),
  };

  const startTime = Date.now();

  try {
    const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: 'Gateway error', detail: text });
      return;
    }

    const data = await upstream.json() as ChatCompletionResponse;
    const elapsed = Date.now() - startTime;

    const responseText = data?.choices?.[0]?.message?.content ?? '';
    const responseModel = data?.model ?? model ?? 'default';
    const tokens = data?.usage?.total_tokens;

    res.json({
      response: responseText,
      model: responseModel,
      tokens,
      elapsedMs: elapsed,
    });
  } catch (err) {
    console.error('Playground run error:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

export default router;
