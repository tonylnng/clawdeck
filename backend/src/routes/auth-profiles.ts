import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const VALID_AGENT_IDS = ['main', 'tonic-ai-tech', 'tonic-ai-workflow'];

interface RawProfile {
  type?: string;
  provider?: string;
  key?: string;
  [key: string]: unknown;
}

interface UsageStat {
  lastUsed?: number;
  errorCount?: number;
  lastFailureAt?: number;
  [key: string]: unknown;
}

interface AuthProfileFile {
  version?: number;
  profiles?: Record<string, RawProfile>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, UsageStat>;
}

interface ProfileSummary {
  name: string;
  provider: string;
  redactedKey: string;
  hasUsageStats: boolean;
  cooldownActive: boolean;
  usageStatsSummary: {
    lastUsed?: string;
    errorCount?: number;
    lastFailureAt?: string;
  } | null;
}

function redactKey(key: string | undefined): string {
  if (!key) return '(none)';
  if (key.length <= 14) return '***';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function isCooldownActive(stat: UsageStat | undefined): boolean {
  if (!stat) return false;
  // Cooldown is considered active if there was a recent failure and errorCount > 0
  if (stat.errorCount && stat.errorCount > 0 && stat.lastFailureAt) {
    const hoursSinceFail = (Date.now() - stat.lastFailureAt) / (1000 * 60 * 60);
    return hoursSinceFail < 24;
  }
  return false;
}

// Allow override via env so Docker containers can map the correct host path.
// OPENCLAW_HOME defaults to /home/tonic to match the volume mount.
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/home/tonic';

function getAuthProfilePath(agentId: string): string {
  return path.join(OPENCLAW_HOME, '.openclaw', 'agents', agentId, 'agent', 'auth-profiles.json');
}

async function readAuthFile(agentId: string): Promise<AuthProfileFile | null> {
  const filePath = getAuthProfilePath(agentId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as AuthProfileFile;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// GET /api/auth-profiles/:agentId
router.get('/:agentId', async (req: Request, res: Response) => {
  const { agentId } = req.params;

  if (!VALID_AGENT_IDS.includes(agentId)) {
    res.status(400).json({ error: `Unknown agentId: ${agentId}` });
    return;
  }

  try {
    const data = await readAuthFile(agentId);

    if (!data) {
      res.status(404).json({ error: `auth-profiles.json not found for agent: ${agentId}` });
      return;
    }

    const profiles = data.profiles ?? {};
    const usageStats = data.usageStats ?? {};

    const summaries: ProfileSummary[] = Object.entries(profiles).map(([name, profile]) => {
      const stat = usageStats[name];
      const hasUsageStats = stat !== undefined;
      return {
        name,
        provider: profile.provider ?? 'unknown',
        redactedKey: redactKey(profile.key),
        hasUsageStats,
        cooldownActive: isCooldownActive(stat),
        usageStatsSummary: hasUsageStats
          ? {
              lastUsed: stat.lastUsed ? new Date(stat.lastUsed).toISOString() : undefined,
              errorCount: stat.errorCount,
              lastFailureAt: stat.lastFailureAt ? new Date(stat.lastFailureAt).toISOString() : undefined,
            }
          : null,
      };
    });

    res.json({
      agentId,
      version: data.version ?? 1,
      profiles: summaries,
    });
  } catch (err) {
    console.error('Failed to read auth profiles:', err);
    res.status(500).json({ error: 'Failed to read auth profiles', detail: String(err) });
  }
});

// POST /api/auth-profiles/:agentId/reset-cooldown
router.post('/:agentId/reset-cooldown', async (req: Request, res: Response) => {
  const { agentId } = req.params;

  if (!VALID_AGENT_IDS.includes(agentId)) {
    res.status(400).json({ error: `Unknown agentId: ${agentId}` });
    return;
  }

  const filePath = getAuthProfilePath(agentId);

  try {
    const data = await readAuthFile(agentId);

    if (!data) {
      res.status(404).json({ error: `auth-profiles.json not found for agent: ${agentId}` });
      return;
    }

    // Clear all usageStats
    data.usageStats = {};

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    res.json({ success: true, message: `Cooldown reset for ${agentId}` });
  } catch (err) {
    console.error('Failed to reset cooldown:', err);
    res.status(500).json({ error: 'Failed to reset cooldown', detail: String(err) });
  }
});

export default router;
