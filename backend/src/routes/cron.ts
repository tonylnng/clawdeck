import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth';
import { redactMiddleware } from '../middleware/redact';

const router = Router();

router.use(requireAuth);
router.use(redactMiddleware);

// ─── Types ────────────────────────────────────────────────────────────────────

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  task: string;
  agentId: string;
}

interface OpenClawConfig {
  cron?: {
    jobs?: CronJob[];
  };
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || os.homedir();
const CONFIG_PATH = path.join(OPENCLAW_HOME, '.openclaw', 'openclaw.json');

function readConfig(): OpenClawConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as OpenClawConfig;
}

function writeConfig(config: OpenClawConfig): void {
  const json = JSON.stringify(config, null, 2);
  fs.writeFileSync(CONFIG_PATH, json, 'utf-8');
}

function getJobs(config: OpenClawConfig): CronJob[] {
  return config?.cron?.jobs ?? [];
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Validate cron schedule: exactly 5 space-separated fields
// Each field must be a valid cron field (numbers, *, /, -, ,)
const CRON_FIELD_RE = /^(\*|[0-9*,/\-]+)$/;

function isValidCronSchedule(schedule: string): boolean {
  if (typeof schedule !== 'string') return false;
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f) => CRON_FIELD_RE.test(f));
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/cron — list all cron jobs
router.get('/', (_req: Request, res: Response) => {
  try {
    const config = readConfig();
    const jobs = getJobs(config);
    res.json({ jobs });
  } catch (err) {
    console.error('Failed to read cron jobs:', err);
    res.status(500).json({ error: 'Failed to read config', detail: String(err) });
  }
});

// POST /api/cron — create a new cron job
router.post('/', (req: Request, res: Response) => {
  const { name, schedule, task, agentId, enabled } = req.body as Partial<CronJob>;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!schedule || !isValidCronSchedule(schedule)) {
    res.status(400).json({ error: 'Invalid cron schedule. Must be 5 fields (e.g. "0 9 * * *")' });
    return;
  }
  if (!task || typeof task !== 'string' || task.trim() === '') {
    res.status(400).json({ error: 'task is required' });
    return;
  }
  if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
    res.status(400).json({ error: 'agentId is required' });
    return;
  }

  try {
    const config = readConfig();

    if (!config.cron) {
      config.cron = { jobs: [] };
    }
    if (!config.cron.jobs) {
      config.cron.jobs = [];
    }

    const newJob: CronJob = {
      id: generateId(),
      name: name.trim(),
      schedule: schedule.trim(),
      enabled: enabled !== false,
      task: task.trim(),
      agentId: agentId.trim(),
    };

    config.cron.jobs.push(newJob);
    writeConfig(config);

    res.status(201).json({ job: newJob });
  } catch (err) {
    console.error('Failed to create cron job:', err);
    res.status(500).json({ error: 'Failed to write config', detail: String(err) });
  }
});

// PUT /api/cron/:id — update a cron job
router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as Partial<CronJob>;

  // Validate schedule if provided
  if (updates.schedule !== undefined && !isValidCronSchedule(updates.schedule)) {
    res.status(400).json({ error: 'Invalid cron schedule. Must be 5 fields (e.g. "0 9 * * *")' });
    return;
  }

  try {
    const config = readConfig();
    const jobs = getJobs(config);
    const idx = jobs.findIndex((j) => j.id === id);

    if (idx === -1) {
      res.status(404).json({ error: 'Cron job not found' });
      return;
    }

    const existing = jobs[idx];
    const updated: CronJob = {
      ...existing,
      ...(updates.name !== undefined ? { name: String(updates.name).trim() } : {}),
      ...(updates.schedule !== undefined ? { schedule: String(updates.schedule).trim() } : {}),
      ...(updates.task !== undefined ? { task: String(updates.task).trim() } : {}),
      ...(updates.agentId !== undefined ? { agentId: String(updates.agentId).trim() } : {}),
      ...(updates.enabled !== undefined ? { enabled: Boolean(updates.enabled) } : {}),
      id: existing.id, // preserve original id
    };

    jobs[idx] = updated;

    if (!config.cron) config.cron = {};
    config.cron.jobs = jobs;

    writeConfig(config);

    res.json({ job: updated });
  } catch (err) {
    console.error('Failed to update cron job:', err);
    res.status(500).json({ error: 'Failed to write config', detail: String(err) });
  }
});

// DELETE /api/cron/:id — delete a cron job
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const config = readConfig();
    const jobs = getJobs(config);
    const idx = jobs.findIndex((j) => j.id === id);

    if (idx === -1) {
      res.status(404).json({ error: 'Cron job not found' });
      return;
    }

    jobs.splice(idx, 1);

    if (!config.cron) config.cron = {};
    config.cron.jobs = jobs;

    writeConfig(config);

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete cron job:', err);
    res.status(500).json({ error: 'Failed to write config', detail: String(err) });
  }
});

export default router;
