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

interface SessionEntry {
  key: string;
  model?: string;
  channel?: string;
  updatedAt?: number;
  createdAt?: number;
  messageCount?: number;
  messages?: MessageEntry[];
}

interface MessageEntry {
  role?: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface GatewaySessionsResult {
  result?: {
    details?: {
      sessions?: SessionEntry[];
    };
    content?: unknown[];
  };
}

interface AgentUsage {
  id: string;
  sessions: number;
  messages: number;
  estimatedTokens: number;
}

interface ModelUsage {
  model: string;
  agents: string[];
  sessions: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function invokeGatewayTool(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ tool, args }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Estimate tokens from message count when no explicit token data is available.
 * Rough heuristic: ~150 tokens per message (avg user+assistant turn).
 */
function estimateTokens(messageCount: number): number {
  return messageCount * 150;
}

// ─── GET /api/analytics/usage ─────────────────────────────────────────────────

router.get('/usage', async (_req: Request, res: Response) => {
  try {
    const raw = (await invokeGatewayTool('sessions_list', {
      messageLimit: 5,
    })) as GatewaySessionsResult;

    const sessions: SessionEntry[] = raw?.result?.details?.sessions ?? [];

    // Aggregate per-agent stats
    const agentMap = new Map<string, AgentUsage>();

    for (const session of sessions) {
      const parts = session.key.split(':');
      if (parts[0] !== 'agent' || !parts[1]) continue;
      const agentId = parts[1];

      // Count messages: prefer explicit count, fall back to messages array length
      const msgCount =
        session.messageCount ??
        session.messages?.length ??
        0;

      // Sum tokens if available, otherwise estimate
      let tokens = 0;
      if (session.messages && session.messages.length > 0) {
        for (const msg of session.messages) {
          tokens +=
            (msg.tokens ?? 0) +
            (msg.inputTokens ?? 0) +
            (msg.outputTokens ?? 0);
        }
      }
      // If no token data found from messages, estimate
      if (tokens === 0) {
        tokens = estimateTokens(msgCount);
      }

      const existing = agentMap.get(agentId);
      if (existing) {
        existing.sessions += 1;
        existing.messages += msgCount;
        existing.estimatedTokens += tokens;
      } else {
        agentMap.set(agentId, {
          id: agentId,
          sessions: 1,
          messages: msgCount,
          estimatedTokens: tokens,
        });
      }
    }

    const agents = Array.from(agentMap.values());
    const totalSessions = agents.reduce((sum, a) => sum + a.sessions, 0);
    const totalMessages = agents.reduce((sum, a) => sum + a.messages, 0);

    res.json({
      agents,
      totalSessions,
      totalMessages,
      period: 'all-time',
    });
  } catch (err) {
    console.error('Failed to fetch analytics/usage:', err);
    res.status(502).json({
      error: 'Failed to reach gateway',
      detail: String(err),
    });
  }
});

// ─── GET /api/analytics/models ────────────────────────────────────────────────

router.get('/models', async (_req: Request, res: Response) => {
  try {
    const raw = (await invokeGatewayTool('sessions_list', {
      messageLimit: 5,
    })) as GatewaySessionsResult;

    const sessions: SessionEntry[] = raw?.result?.details?.sessions ?? [];

    // model → { agents: Set<agentId>, sessions: number }
    const modelMap = new Map<string, { agents: Set<string>; sessions: number }>();

    for (const session of sessions) {
      const parts = session.key.split(':');
      if (parts[0] !== 'agent' || !parts[1]) continue;
      const agentId = parts[1];
      const model = session.model || 'unknown';

      const existing = modelMap.get(model);
      if (existing) {
        existing.agents.add(agentId);
        existing.sessions += 1;
      } else {
        modelMap.set(model, { agents: new Set([agentId]), sessions: 1 });
      }
    }

    const models: ModelUsage[] = Array.from(modelMap.entries()).map(
      ([model, data]) => ({
        model,
        agents: Array.from(data.agents),
        sessions: data.sessions,
      }),
    );

    // Sort by sessions descending
    models.sort((a, b) => b.sessions - a.sessions);

    res.json({ models });
  } catch (err) {
    console.error('Failed to fetch analytics/models:', err);
    res.status(502).json({
      error: 'Failed to reach gateway',
      detail: String(err),
    });
  }
});

export default router;
