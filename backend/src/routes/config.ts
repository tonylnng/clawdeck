import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// GET /api/config — return current ClawDeck configuration (no secrets)
router.get('/', (_req: Request, res: Response) => {
  const agentIds = (process.env.CLAWDECK_AGENTS || 'main')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const workspaces: Record<string, string> = {};
  for (const agentId of agentIds) {
    const envKey = `WORKSPACE_${agentId.toUpperCase().replace(/-/g, '_')}`;
    workspaces[agentId] = process.env[envKey] || '';
  }

  res.json({
    agents: agentIds,
    workspaces,
    gatewayUrl: GATEWAY_URL,
    gatewayConfigured: Boolean(GATEWAY_URL && GATEWAY_TOKEN),
  });
});

// GET /api/config/health — check gateway connectivity
router.get('/health', async (_req: Request, res: Response) => {
  if (!GATEWAY_URL || !GATEWAY_TOKEN) {
    res.json({ gateway: 'unconfigured' });
    return;
  }

  try {
    const r = await fetch(`${GATEWAY_URL}/health`, {
      headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    res.json({ gateway: r.ok ? 'ok' : 'error', status: r.status });
  } catch (err) {
    res.json({ gateway: 'unreachable', detail: String(err) });
  }
});

export default router;
