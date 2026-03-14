import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Known agents — dynamically loaded from CLAWDECK_AGENTS env var (comma-separated)
const KNOWN_AGENTS = (process.env.CLAWDECK_AGENTS || 'main')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Agent ID → session key mapping
function getSessionKey(agentId: string): string {
  // For the main agent, session key is typically just the agentId or 'main'
  return agentId;
}

async function invokeMemoryTool(
  tool: string,
  args: Record<string, unknown>,
  agentId: string
): Promise<unknown> {
  const sessionKey = getSessionKey(agentId);
  const res = await fetch(`${GATEWAY_URL}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ tool, args, sessionKey }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  return res.json();
}

// Broad queries used to simulate "list all" — gateway rejects empty strings
const LIST_ALL_QUERIES = [
  'the', 'a', 'is', 'to', 'and', 'project', 'agent', 'system', 'user', 'task',
];

interface Memory {
  id: string;
  text: string;
  category?: string;
  importance?: number;
  scope?: string;
  created_at?: string;
}

// Parse a single "Found N memories:\n\n1. [category:scope] text (score%)" text block
function parseMemoryText(raw: string): Memory[] {
  const memories: Memory[] = [];
  if (!raw || raw.includes('No relevant memories found')) return memories;

  // Match lines like: 1. [category:scope] text (score%, ...)
  const lineRe = /^\d+\.\s+\[([^\]]+)\]\s+([\s\S]*?)\s+\(\d+%/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRe.exec(raw)) !== null) {
    const scopePart = match[1]; // e.g. "fact:global" or "decision:agent:main"
    const text = match[2].trim();
    const parts = scopePart.split(':');
    const category = parts[0] || 'other';
    const scope = parts.slice(1).join(':') || 'global';

    memories.push({
      id: `${scope}-${Buffer.from(text.slice(0, 40)).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`,
      text,
      category,
      scope,
    });
  }

  return memories;
}

// Extract memory array from various gateway response shapes
function extractMemories(data: unknown): Memory[] {
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;

  // Unwrap { result: { ... } }
  const result = obj.result && typeof obj.result === 'object'
    ? obj.result as Record<string, unknown>
    : obj;

  // Structured array fields (future-proof)
  for (const key of ['memories', 'results', 'items']) {
    if (Array.isArray(result[key])) return result[key] as Memory[];
  }

  // content[] array — gateway returns text blocks
  if (Array.isArray(result.content)) {
    const memories: Memory[] = [];
    for (const item of result.content as Record<string, unknown>[]) {
      if (item.type === 'text' && typeof item.text === 'string') {
        memories.push(...parseMemoryText(item.text));
      }
    }
    return memories;
  }

  return [];
}

// GET /api/memory/:agentId — list all memories (broad multi-query sweep)
router.get('/:agentId', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  if (!KNOWN_AGENTS.includes(agentId)) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }

  try {
    // Fan out across broad queries to maximise recall coverage
    const results = await Promise.allSettled(
      LIST_ALL_QUERIES.map((q) =>
        invokeMemoryTool('memory_recall', { query: q, limit: 20 }, agentId)
      )
    );

    // Merge + deduplicate by memory id
    const seen = new Set<string>();
    const memories: Memory[] = [];

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const mem of extractMemories(r.value)) {
        const id = mem.id || '';
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        memories.push(mem);
      }
    }

    res.json({ memories, count: memories.length });
  } catch (err) {
    console.error('Failed to list memories:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// GET /api/memory/:agentId/search?q= — search memories
router.get('/:agentId/search', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const q = ((req.query.q as string) || '').trim();

  if (!KNOWN_AGENTS.includes(agentId)) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }

  // If query is empty, fall back to broad list
  if (!q) {
    res.redirect(`/api/memory/${encodeURIComponent(agentId)}`);
    return;
  }

  try {
    const result = await invokeMemoryTool('memory_recall', { query: q, limit: 20 }, agentId);
    const memories = extractMemories(result);
    res.json({ memories, count: memories.length, query: q });
  } catch (err) {
    console.error('Failed to search memories:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// DELETE /api/memory/:agentId/:memId — delete a memory
router.delete('/:agentId/:memId', async (req: Request, res: Response) => {
  const { agentId, memId } = req.params;

  if (!KNOWN_AGENTS.includes(agentId)) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }

  try {
    const result = await invokeMemoryTool('memory_forget', { memoryId: memId }, agentId);
    res.json(result);
  } catch (err) {
    console.error('Failed to delete memory:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

export default router;
