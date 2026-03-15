import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';

const router = Router();
router.use(requireAuth);

// Instances config file path
const INSTANCES_FILE = path.join(os.homedir(), '.openclaw', 'clawdeck-instances.json');

// ── Types ─────────────────────────────────────────────────────────────────────

interface Instance {
  id: string;
  name: string;
  url: string;
  token: string;
  color: string;
  notes?: string;
  addedAt: string;
  useProxy?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readInstances(): Promise<Instance[]> {
  try {
    const data = await fs.readFile(INSTANCES_FILE, 'utf-8');
    const parsed = JSON.parse(data) as { instances?: Instance[] };
    return parsed.instances ?? [];
  } catch {
    return [];
  }
}

async function writeInstances(instances: Instance[]): Promise<void> {
  await fs.mkdir(path.dirname(INSTANCES_FILE), { recursive: true });
  await fs.writeFile(INSTANCES_FILE, JSON.stringify({ instances }, null, 2));
}

async function pingInstance(url: string, token: string): Promise<{ ok: boolean; latencyMs?: number; version?: string; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json() as { version?: string; proxy?: string };
      return { ok: true, latencyMs, version: data.version ?? data.proxy ?? 'unknown' };
    }
    return { ok: false, latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/instances - list all instances
router.get('/', async (_req: Request, res: Response) => {
  const instances = await readInstances();
  // Return instances without tokens
  const safe = instances.map(({ token: _t, ...rest }) => rest);
  res.json({ instances: safe });
});

// POST /api/instances - add instance
router.post('/', async (req: Request, res: Response) => {
  const { name, url, token, color, notes, useProxy } = req.body as Partial<Instance>;
  if (!name || !url || !token) {
    res.status(400).json({ error: 'name, url, and token are required' });
    return;
  }
  const instances = await readInstances();
  const newInstance: Instance = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    url: url.replace(/\/$/, ''),
    token,
    color: color ?? '#6366f1',
    notes,
    addedAt: new Date().toISOString(),
    useProxy: useProxy ?? false,
  };
  instances.push(newInstance);
  await writeInstances(instances);
  const { token: _t, ...safe } = newInstance;
  res.json({ instance: safe });
});

// PUT /api/instances/:id - update instance
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instances = await readInstances();
  const idx = instances.findIndex((i) => i.id === id);
  if (idx === -1) { res.status(404).json({ error: 'Instance not found' }); return; }
  const { name, url, token, color, notes, useProxy } = req.body as Partial<Instance>;
  if (name) instances[idx].name = name;
  if (url) instances[idx].url = url.replace(/\/$/, '');
  if (token) instances[idx].token = token;
  if (color) instances[idx].color = color;
  if (notes !== undefined) instances[idx].notes = notes;
  if (useProxy !== undefined) instances[idx].useProxy = useProxy;
  await writeInstances(instances);
  const { token: _t, ...safe } = instances[idx];
  res.json({ instance: safe });
});

// DELETE /api/instances/:id - remove instance
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instances = await readInstances();
  const filtered = instances.filter((i) => i.id !== id);
  if (filtered.length === instances.length) { res.status(404).json({ error: 'Instance not found' }); return; }
  await writeInstances(filtered);
  res.json({ ok: true });
});

// GET /api/instances/:id/status - ping instance
router.get('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instances = await readInstances();
  const inst = instances.find((i) => i.id === id);
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  const result = await pingInstance(inst.url, inst.token);
  res.json({ id, name: inst.name, ...result });
});

// POST /api/instances/ping - test before saving
router.post('/ping', async (req: Request, res: Response) => {
  const { url, token } = req.body as { url?: string; token?: string };
  if (!url || !token) { res.status(400).json({ error: 'url and token required' }); return; }
  const result = await pingInstance(url.replace(/\/$/, ''), token);
  res.json(result);
});

// GET /api/instances/:id/agents - list agents on a remote instance
router.get('/:id/agents', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instances = await readInstances();
  const inst = instances.find((i) => i.id === id);
  if (!inst) { res.status(404).json({ error: 'Instance not found' }); return; }
  try {
    const upstream = await fetch(`${inst.url}/api/agents`, {
      headers: { Authorization: `Bearer ${inst.token}`, Cookie: '' },
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach instance', detail: String(err) });
  }
});

// GET /api/instances/all/status - ping all instances
router.get('/all/status', async (_req: Request, res: Response) => {
  const instances = await readInstances();
  const results = await Promise.all(
    instances.map(async (inst) => {
      const result = await pingInstance(inst.url, inst.token);
      return { id: inst.id, name: inst.name, color: inst.color, ...result };
    })
  );
  res.json({ instances: results });
});

export default router;
