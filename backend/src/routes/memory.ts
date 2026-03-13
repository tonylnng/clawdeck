import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Known agents
const KNOWN_AGENTS = ['main', 'tonic-ai-tech', 'tonic-ai-workflow'];

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

// GET /api/memory/:agentId — list all memories
router.get('/:agentId', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  if (!KNOWN_AGENTS.includes(agentId)) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }

  try {
    const result = await invokeMemoryTool('memory_recall', { query: '' }, agentId);
    res.json(result);
  } catch (err) {
    console.error('Failed to list memories:', err);
    res.status(502).json({ error: 'Failed to reach gateway', detail: String(err) });
  }
});

// GET /api/memory/:agentId/search?q= — search memories
router.get('/:agentId/search', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const q = (req.query.q as string) || '';

  if (!KNOWN_AGENTS.includes(agentId)) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }

  try {
    const result = await invokeMemoryTool('memory_recall', { query: q }, agentId);
    res.json(result);
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
