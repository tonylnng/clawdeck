import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const AGENT_TIMEOUT_MS = 30000;

interface HistoryMessage {
  role: string;
  content: string;
  agentId?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// POST /api/groupchat/send
// Body: { agents: string[], message: string, history: HistoryMessage[], model?: string }
router.post('/send', async (req: Request, res: Response) => {
  const { agents, message, history = [], model } = req.body as {
    agents: string[];
    message: string;
    history: HistoryMessage[];
    model?: string;
  };

  if (!agents || !Array.isArray(agents) || agents.length < 2) {
    res.status(400).json({ error: 'At least 2 agents required' });
    return;
  }
  if (agents.length > 6) {
    res.status(400).json({ error: 'Maximum 6 agents allowed' });
    return;
  }
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Build conversation history from prior chat (excluding group agent messages context)
  // Prior history messages go in as-is for context
  const baseHistoryMessages = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.agentId ? `[${m.agentId}]: ${m.content}` : m.content,
  }));

  // Add the current user message
  baseHistoryMessages.push({ role: 'user', content: message });

  // Collect replies from each agent in order
  const agentReplies: Array<{ agentId: string; content: string }> = [];

  for (const agentId of agents) {
    const otherAgents = agents.filter((a) => a !== agentId).join(', ');

    const systemMessage = {
      role: 'system' as const,
      content: `You are ${agentId} participating in a group discussion. Other participants: ${otherAgents}. Respond naturally as your character. Keep responses concise (2-3 sentences max).`,
    };

    // Build messages: system + history + user msg + previous agent replies
    const messages = [
      systemMessage,
      ...baseHistoryMessages,
      ...agentReplies.map((r) => ({
        role: 'assistant' as const,
        content: `[${r.agentId}]: ${r.content}`,
      })),
    ];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

      let content = '';

      try {
        const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
          },
          body: JSON.stringify({
            model: model || 'default',
            stream: false,
            messages,
            session: agentId,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!upstream.ok) {
          const errText = await upstream.text();
          console.error(`Group chat: agent ${agentId} error ${upstream.status}: ${errText}`);
          content = `[Error: ${upstream.status}]`;
        } else {
          const data = await upstream.json() as ChatCompletionResponse;
          content = data?.choices?.[0]?.message?.content || '[No response]';
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        const errName = (fetchErr as Error)?.name;
        if (errName === 'AbortError') {
          content = '[Timeout after 30s]';
        } else {
          console.error(`Group chat: agent ${agentId} fetch error:`, fetchErr);
          content = '[Connection error]';
        }
      }

      agentReplies.push({ agentId, content });
      sendEvent({ agentId, content, done: false });

    } catch (err) {
      console.error(`Group chat: unexpected error for agent ${agentId}:`, err);
      agentReplies.push({ agentId, content: '[Error]' });
      sendEvent({ agentId, content: '[Error]', done: false });
    }
  }

  sendEvent({ done: true });
  res.end();
});

export default router;
