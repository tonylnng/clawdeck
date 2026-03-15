import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = Router();
router.use(requireAuth);

const LOCAL_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const LOCAL_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const AGENT_TIMEOUT_MS = 60000;
const INSTANCES_FILE = path.join(os.homedir(), '.openclaw', 'clawdeck-instances.json');

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentRef {
  agentId: string;       // e.g. "main", "tonic-ai-tech"
  instanceId?: string;   // undefined or "local" = local gateway, else remote instance ID
  displayName?: string;  // optional override label
}

interface InstanceConfig {
  id: string;
  name: string;
  url: string;
  token: string;
  color: string;
}

interface HistoryMessage {
  role: string;
  content: string;
  agentId?: string;
  instanceId?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readInstances(): Promise<InstanceConfig[]> {
  try {
    const data = await fs.readFile(INSTANCES_FILE, 'utf-8');
    const parsed = JSON.parse(data) as { instances?: InstanceConfig[] };
    return parsed.instances ?? [];
  } catch {
    return [];
  }
}

function getGatewayConfig(instanceId: string | undefined, instances: InstanceConfig[]): { url: string; token: string } {
  if (!instanceId || instanceId === 'local') {
    return { url: LOCAL_GATEWAY_URL, token: LOCAL_GATEWAY_TOKEN };
  }
  const inst = instances.find((i) => i.id === instanceId);
  if (!inst) {
    return { url: LOCAL_GATEWAY_URL, token: LOCAL_GATEWAY_TOKEN };
  }
  return { url: inst.url, token: inst.token };
}

function normalizeAgentSessionKey(agentId: string): string {
  if (agentId.startsWith('agent:')) return agentId;
  return `agent:${agentId}:main`;
}

// ── POST /api/groupchat/send ──────────────────────────────────────────────────
// Body: {
//   agents: AgentRef[],          // NEW: array of {agentId, instanceId?, displayName?}
//   message: string,
//   history: HistoryMessage[],
//   model?: string
// }
//
// Legacy support: agents can also be string[] (old format, all local)

router.post('/send', async (req: Request, res: Response) => {
  const { agents: rawAgents, message, history = [], model } = req.body as {
    agents: (AgentRef | string)[];
    message: string;
    history: HistoryMessage[];
    model?: string;
  };

  if (!rawAgents || !Array.isArray(rawAgents) || rawAgents.length < 2) {
    res.status(400).json({ error: 'At least 2 agents required' });
    return;
  }
  if (rawAgents.length > 6) {
    res.status(400).json({ error: 'Maximum 6 agents allowed' });
    return;
  }
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Normalize agents (support legacy string[] format)
  const agents: AgentRef[] = rawAgents.map((a) =>
    typeof a === 'string'
      ? { agentId: a, instanceId: 'local' }
      : { agentId: a.agentId, instanceId: a.instanceId || 'local', displayName: a.displayName }
  );

  // Load instances config
  const instances = await readInstances();

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Build display labels for each agent
  const getDisplayLabel = (agent: AgentRef): string => {
    if (agent.displayName) return agent.displayName;
    if (!agent.instanceId || agent.instanceId === 'local') return agent.agentId;
    const inst = instances.find((i) => i.id === agent.instanceId);
    return inst ? `${agent.agentId}@${inst.name}` : `${agent.agentId}@${agent.instanceId}`;
  };

  // Build base history
  const baseHistoryMessages = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.agentId ? `[${m.agentId}]: ${m.content}` : m.content,
  }));
  baseHistoryMessages.push({ role: 'user', content: message });

  // Sequential agent calls
  const agentReplies: Array<{ displayLabel: string; content: string }> = [];

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const displayLabel = getDisplayLabel(agent);
    const { url: gatewayUrl, token: gatewayToken } = getGatewayConfig(agent.instanceId, instances);
    const sessionKey = normalizeAgentSessionKey(agent.agentId);

    const otherLabels = agents
      .filter((_, j) => j !== i)
      .map((a) => getDisplayLabel(a))
      .join(', ');

    // Signal thinking
    sendEvent({ agentId: displayLabel, instanceId: agent.instanceId || 'local', thinking: true, done: false });

    const systemMessage = {
      role: 'system' as const,
      content: `You are ${displayLabel} participating in a group discussion. Other participants: ${otherLabels}. Respond naturally and concisely (2-3 sentences max).`,
    };

    const messages = [
      systemMessage,
      ...baseHistoryMessages,
      ...agentReplies.map((r) => ({
        role: 'assistant' as const,
        content: `[${r.displayLabel}]: ${r.content}`,
      })),
    ];

    let content = '';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

      try {
        const upstream = await fetch(`${gatewayUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${gatewayToken}`,
          },
          body: JSON.stringify({
            model: model || 'default',
            stream: false,
            messages,
            session: sessionKey,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!upstream.ok) {
          const errText = await upstream.text();
          console.error(`Group chat: agent ${displayLabel} error ${upstream.status}: ${errText}`);
          content = `[Error ${upstream.status}: ${upstream.statusText}]`;
        } else {
          const data = await upstream.json() as ChatCompletionResponse;
          content = data?.choices?.[0]?.message?.content || '[No response]';
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        const errName = (fetchErr as Error)?.name;
        content = errName === 'AbortError' ? '[Timeout after 60s]' : `[Connection error: ${(fetchErr as Error).message}]`;
      }
    } catch (err) {
      content = `[Error: ${(err as Error).message}]`;
    }

    agentReplies.push({ displayLabel, content });
    sendEvent({ agentId: displayLabel, instanceId: agent.instanceId || 'local', content, done: false });
  }

  sendEvent({ done: true });
  res.end();
});

// GET /api/groupchat/instances — list available instances for agent selection
router.get('/instances', async (_req: Request, res: Response) => {
  const instances = await readInstances();
  res.json({
    instances: [
      { id: 'local', name: 'Local (this machine)', color: '#6366f1' },
      ...instances.map(({ id, name, color }) => ({ id, name, color })),
    ],
  });
});

export default router;
