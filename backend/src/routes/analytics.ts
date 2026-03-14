import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';
import { redactMiddleware } from '../middleware/redact';

const router = Router();

router.use(requireAuth);
router.use(redactMiddleware);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Known agent IDs from env
const CLAWDECK_AGENTS = (process.env.CLAWDECK_AGENTS || 'main').split(',').map((s) => s.trim());

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

// jsonl event types from session files
interface JsonlUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

interface JsonlMessage {
  type: string;
  timestamp?: string;
  usage?: JsonlUsage;
  api?: string;
  provider?: string;
  model?: string;
}

// ─── Helper: invoke gateway tool ──────────────────────────────────────────────

async function invokeGatewayTool(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${GATEWAY_URL}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({ tool, args }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway error ${res.status}: ${text}`);
    }
    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Estimate tokens from message count when no explicit token data is available.
 */
function estimateTokens(messageCount: number): number {
  return messageCount * 150;
}

// ─── Helper: read jsonl session files for an agent ────────────────────────────

async function readJsonlMessages(agentId: string): Promise<JsonlMessage[]> {
  const workspaceKey = `WORKSPACE_${agentId.toUpperCase().replace(/-/g, '_')}`;
  const workspacePath = process.env[workspaceKey] || `/home/tonic/.openclaw/workspace`;
  const sessionsDir = path.join(path.dirname(workspacePath), `agents/${agentId}/sessions`);
  
  // Try standard location
  const standardDir = `/home/tonic/.openclaw/agents/${agentId}/sessions`;
  const dir = fs.existsSync(standardDir) ? standardDir : sessionsDir;
  
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl') && !f.includes('.reset'))
    .map((f) => path.join(dir, f));

  const allMessages: JsonlMessage[] = [];

  for (const file of files) {
    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const obj = JSON.parse(line) as JsonlMessage;
          if (obj.type === 'message' && obj.usage) {
            allMessages.push(obj);
          }
        } catch { /* skip */ }
      });
      rl.on('close', resolve);
      rl.on('error', resolve);
    });
  }

  return allMessages;
}

// ─── GET /api/analytics/usage ─────────────────────────────────────────────────

router.get('/usage', async (_req: Request, res: Response) => {
  try {
    const raw = (await invokeGatewayTool('sessions_list', {
      messageLimit: 5,
    })) as GatewaySessionsResult;

    const sessions: SessionEntry[] = raw?.result?.details?.sessions ?? [];

    const agentMap = new Map<string, AgentUsage>();

    for (const session of sessions) {
      const parts = session.key.split(':');
      if (parts[0] !== 'agent' || !parts[1]) continue;
      const agentId = parts[1];

      const msgCount = session.messageCount ?? session.messages?.length ?? 0;

      let tokens = 0;
      if (session.messages && session.messages.length > 0) {
        for (const msg of session.messages) {
          tokens += (msg.tokens ?? 0) + (msg.inputTokens ?? 0) + (msg.outputTokens ?? 0);
        }
      }
      if (tokens === 0) tokens = estimateTokens(msgCount);

      const existing = agentMap.get(agentId);
      if (existing) {
        existing.sessions += 1;
        existing.messages += msgCount;
        existing.estimatedTokens += tokens;
      } else {
        agentMap.set(agentId, { id: agentId, sessions: 1, messages: msgCount, estimatedTokens: tokens });
      }
    }

    const agents = Array.from(agentMap.values());
    const totalSessions = agents.reduce((sum, a) => sum + a.sessions, 0);
    const totalMessages = agents.reduce((sum, a) => sum + a.messages, 0);

    res.json({ agents, totalSessions, totalMessages, period: 'all-time' });
  } catch (err) {
    console.error('Failed to fetch analytics/usage:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// ─── GET /api/analytics/models ────────────────────────────────────────────────

router.get('/models', async (_req: Request, res: Response) => {
  try {
    const raw = (await invokeGatewayTool('sessions_list', { messageLimit: 5 })) as GatewaySessionsResult;
    const sessions: SessionEntry[] = raw?.result?.details?.sessions ?? [];

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

    const models: ModelUsage[] = Array.from(modelMap.entries()).map(([model, data]) => ({
      model,
      agents: Array.from(data.agents),
      sessions: data.sessions,
    }));
    models.sort((a, b) => b.sessions - a.sessions);

    res.json({ models });
  } catch (err) {
    console.error('Failed to fetch analytics/models:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// ─── GET /api/analytics/timeseries ────────────────────────────────────────────
// Returns daily token usage + cost per agent over last N days (from jsonl files)

router.get('/timeseries', async (_req: Request, res: Response) => {
  try {
    // Build a map: date → agentId → { tokens, cost }
    const dateAgentMap = new Map<string, Map<string, { tokens: number; cost: number }>>();

    for (const agentId of CLAWDECK_AGENTS) {
      const messages = await readJsonlMessages(agentId);

      for (const msg of messages) {
        if (!msg.timestamp) continue;
        const date = msg.timestamp.slice(0, 10); // YYYY-MM-DD
        const tokens = (msg.usage?.input ?? 0) + (msg.usage?.output ?? 0) + (msg.usage?.cacheRead ?? 0);
        const cost = msg.usage?.cost?.total ?? 0;

        if (!dateAgentMap.has(date)) dateAgentMap.set(date, new Map());
        const agentMap = dateAgentMap.get(date)!;
        const existing = agentMap.get(agentId);
        if (existing) {
          existing.tokens += tokens;
          existing.cost += cost;
        } else {
          agentMap.set(agentId, { tokens, cost });
        }
      }
    }

    // Convert to sorted array of { date, agents: { [agentId]: { tokens, cost } } }
    const sorted = Array.from(dateAgentMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30) // last 30 days
      .map(([date, agentMap]) => {
        const agents: Record<string, { tokens: number; cost: number }> = {};
        agentMap.forEach((val, agentId) => { agents[agentId] = val; });
        return { date, agents };
      });

    res.json({ series: sorted, agentIds: CLAWDECK_AGENTS });
  } catch (err) {
    console.error('Failed to fetch analytics/timeseries:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/errors ────────────────────────────────────────────────
// Parses gateway log files for ERROR/WARN entries, grouped by day + type

router.get('/errors', async (_req: Request, res: Response) => {
  try {
    const logDir = '/tmp/openclaw';
    if (!fs.existsSync(logDir)) {
      return res.json({ buckets: [], total: 0 });
    }

    const logFiles = fs.readdirSync(logDir)
      .filter((f) => f.startsWith('openclaw-') && f.endsWith('.log'))
      .sort()
      .slice(-7); // last 7 days of logs

    // date → category → count
    const bucketMap = new Map<string, Map<string, number>>();
    let total = 0;

    for (const file of logFiles) {
      // Extract date from filename: openclaw-YYYY-MM-DD.log
      const dateMatch = file.match(/openclaw-(\d{4}-\d{2}-\d{2})\.log/);
      const date = dateMatch ? dateMatch[1] : 'unknown';

      const filePath = path.join(logDir, file);
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
        rl.on('line', (line) => {
          if (!line.trim()) return;
          try {
            const obj = JSON.parse(line);
            const level: string = obj._meta?.logLevelName ?? '';
            if (level !== 'ERROR' && level !== 'WARN') return;

            const msg: string = String(obj['0'] ?? obj.msg ?? '');
            
            // Categorize
            let category = 'Other';
            if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('concurrency')) {
              category = 'Rate Limit (429)';
            } else if (msg.includes('403') || msg.toLowerCase().includes('region') || msg.toLowerCase().includes('not available')) {
              category = 'Region Block (403)';
            } else if (msg.includes('timeout') || msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('abort')) {
              category = 'Timeout';
            } else if (msg.includes('5') && (msg.includes('500') || msg.includes('502') || msg.includes('503'))) {
              category = '5xx Error';
            } else if (msg.toLowerCase().includes('tool') && msg.toLowerCase().includes('fail')) {
              category = 'Tool Failure';
            } else if (level === 'WARN') {
              category = 'Warning';
            }

            if (!bucketMap.has(date)) bucketMap.set(date, new Map());
            const dayMap = bucketMap.get(date)!;
            dayMap.set(category, (dayMap.get(category) ?? 0) + 1);
            total++;
          } catch { /* skip */ }
        });
        rl.on('close', resolve);
        rl.on('error', resolve);
      });
    }

    // Convert to sorted array
    const buckets = Array.from(bucketMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, catMap]) => {
        const categories: Record<string, number> = {};
        catMap.forEach((count, cat) => { categories[cat] = count; });
        return { date, categories, total: Array.from(catMap.values()).reduce((s, v) => s + v, 0) };
      });

    res.json({ buckets, total });
  } catch (err) {
    console.error('Failed to fetch analytics/errors:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/latency ───────────────────────────────────────────────
// Returns avg response latency (ms) per model and per hour-of-day from session jsonl files

router.get('/latency', async (_req: Request, res: Response) => {
  try {
    // model → hour (0-23) → { totalMs, count }
    const modelHourMap = new Map<string, Map<number, { totalMs: number; count: number }>>();
    // agent → latency buckets (for per-agent heatmap)
    const agentHourMap = new Map<string, Map<number, { totalMs: number; count: number }>>();

    for (const agentId of CLAWDECK_AGENTS) {
      const standardDir = `/home/tonic/.openclaw/agents/${agentId}/sessions`;
      if (!fs.existsSync(standardDir)) continue;

      const files = fs.readdirSync(standardDir)
        .filter((f) => f.endsWith('.jsonl') && !f.includes('.reset'))
        .map((f) => path.join(standardDir, f));

      for (const file of files) {
        const events: JsonlMessage[] = [];

        await new Promise<void>((resolve) => {
          const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
          rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
              const obj = JSON.parse(line) as JsonlMessage & { message?: { role?: string }; id?: string; parentId?: string };
              events.push(obj);
            } catch { /* skip */ }
          });
          rl.on('close', resolve);
          rl.on('error', resolve);
        });

        // Calculate latency: assistant_message.timestamp - user_message.timestamp (paired by parentId)
        // Events with type=message contain role info
        const userEvents = events.filter((e: JsonlMessage & { message?: { role?: string } }) =>
          (e as JsonlMessage & { message?: { role?: string } }).message?.role === 'user' && e.timestamp
        );
        const assistantEvents = events.filter((e: JsonlMessage & { message?: { role?: string } }) =>
          (e as JsonlMessage & { message?: { role?: string } }).message?.role === 'assistant' && e.timestamp && (e as JsonlMessage).model
        );

        // Simple pairing: match consecutive user→assistant pairs by index
        for (let i = 0; i < Math.min(userEvents.length, assistantEvents.length); i++) {
          const userTs = new Date(userEvents[i].timestamp!).getTime();
          const assistTs = new Date(assistantEvents[i].timestamp!).getTime();
          if (isNaN(userTs) || isNaN(assistTs)) continue;
          const latencyMs = assistTs - userTs;
          if (latencyMs < 0 || latencyMs > 300_000) continue; // skip bogus values

          const hour = new Date(assistantEvents[i].timestamp!).getUTCHours();
          const model = assistantEvents[i].model ?? 'unknown';

          // Model map
          if (!modelHourMap.has(model)) modelHourMap.set(model, new Map());
          const mh = modelHourMap.get(model)!;
          const existing = mh.get(hour) ?? { totalMs: 0, count: 0 };
          mh.set(hour, { totalMs: existing.totalMs + latencyMs, count: existing.count + 1 });

          // Agent map
          if (!agentHourMap.has(agentId)) agentHourMap.set(agentId, new Map());
          const ah = agentHourMap.get(agentId)!;
          const existingA = ah.get(hour) ?? { totalMs: 0, count: 0 };
          ah.set(hour, { totalMs: existingA.totalMs + latencyMs, count: existingA.count + 1 });
        }
      }
    }

    // Build heatmap: model → array[24] of avg latency (ms) or null
    const modelHeatmap: Record<string, (number | null)[]> = {};
    modelHourMap.forEach((hourMap, model) => {
      const row: (number | null)[] = Array(24).fill(null);
      hourMap.forEach((val, hour) => {
        row[hour] = Math.round(val.totalMs / val.count);
      });
      modelHeatmap[model] = row;
    });

    const agentHeatmap: Record<string, (number | null)[]> = {};
    agentHourMap.forEach((hourMap, agentId) => {
      const row: (number | null)[] = Array(24).fill(null);
      hourMap.forEach((val, hour) => {
        row[hour] = Math.round(val.totalMs / val.count);
      });
      agentHeatmap[agentId] = row;
    });

    res.json({
      modelHeatmap,
      agentHeatmap,
      hours: Array.from({ length: 24 }, (_, i) => i),
    });
  } catch (err) {
    console.error('Failed to fetch analytics/latency:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
