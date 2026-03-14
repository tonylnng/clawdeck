import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const LOG_DIR = '/tmp/openclaw';
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/home/tonic';
const AGENTS_DIR = path.join(OPENCLAW_HOME, '.openclaw', 'agents');

interface Notification {
  id: string;
  level: 'error' | 'warn' | 'info';
  category: string;
  message: string;
  agentId?: string;
  timestamp: string;
  source: 'gateway' | 'session';
}

// Parse last N lines from log file, extract notifications
async function parseGatewayLogs(limitLines = 500): Promise<Notification[]> {
  if (!fs.existsSync(LOG_DIR)) return [];

  const logFiles = fs.readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('openclaw-') && f.endsWith('.log'))
    .sort()
    .slice(-3); // last 3 days

  const notifications: Notification[] = [];

  for (const file of logFiles) {
    const dateMatch = file.match(/openclaw-(\d{4}-\d{2}-\d{2})\.log/);
    const filePath = path.join(LOG_DIR, file);
    const lines: string[] = [];

    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (line.trim()) lines.push(line);
        if (lines.length > limitLines * 2) lines.shift();
      });
      rl.on('close', resolve);
      rl.on('error', resolve);
    });

    const recent = lines.slice(-limitLines);

    for (const line of recent) {
      try {
        const obj = JSON.parse(line);
        const level: string = obj._meta?.logLevelName ?? '';
        if (level !== 'ERROR' && level !== 'WARN') continue;

        const msg: string = String(obj['0'] ?? obj.msg ?? '');
        const ts: string = obj._meta?.date ?? obj.time ?? (dateMatch?.[1] ? `${dateMatch[1]}T00:00:00.000Z` : new Date().toISOString());

        // Categorize and build notification
        let category = 'General';
        let notifLevel: Notification['level'] = level === 'ERROR' ? 'error' : 'warn';
        let agentId: string | undefined;

        if (msg.includes('429') || msg.toLowerCase().includes('concurrency limit')) {
          category = 'Rate Limit';
          notifLevel = 'warn';
        } else if (msg.includes('403') || msg.toLowerCase().includes('region')) {
          category = 'Region Block';
          notifLevel = 'error';
        } else if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('abort')) {
          category = 'Timeout';
          notifLevel = 'warn';
        } else if (msg.toLowerCase().includes('tool') && msg.toLowerCase().includes('fail')) {
          category = 'Tool Failure';
          notifLevel = 'error';
        } else if (msg.toLowerCase().includes('cooldown')) {
          category = 'Cooldown';
          notifLevel = 'warn';
        } else if (level === 'ERROR') {
          category = 'Error';
        } else {
          category = 'Warning';
        }

        // Try to extract agent from session key patterns
        const agentMatch = msg.match(/agent:([^:\s]+)/);
        if (agentMatch) agentId = agentMatch[1];

        notifications.push({
          id: `gw-${ts}-${notifications.length}`,
          level: notifLevel,
          category,
          message: msg.slice(0, 200),
          agentId,
          timestamp: ts,
          source: 'gateway',
        });
      } catch { /* skip */ }
    }
  }

  return notifications;
}

// Scan session jsonl files for errors/warnings in recent sessions
async function parseSessionErrors(): Promise<Notification[]> {
  if (!fs.existsSync(AGENTS_DIR)) return [];

  const notifications: Notification[] = [];
  const agentDirs = fs.readdirSync(AGENTS_DIR).filter((d) => !d.startsWith('.'));
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // last 7 days

  for (const agentId of agentDirs) {
    const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
    if (!fs.existsSync(sessionsDir)) continue;

    const files = fs.readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl') && !f.includes('.reset'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs }))
      .filter((f) => f.mtime > cutoff)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10); // last 10 sessions per agent

    for (const { name } of files) {
      const filePath = path.join(sessionsDir, name);
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
        rl.on('line', (line) => {
          if (!line.trim()) return;
          try {
            const obj = JSON.parse(line);
            // Look for timeout messages in assistant content
            if (obj.type === 'message' && obj.message?.role === 'assistant') {
              const content = Array.isArray(obj.message?.content)
                ? obj.message.content.map((c: { type: string; text?: string }) => c.text ?? '').join('')
                : String(obj.message?.content ?? '');
              if (content.includes('[Timeout after') || content.includes('[Connection error')) {
                notifications.push({
                  id: `sess-${obj.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
                  level: 'warn',
                  category: 'Session Timeout',
                  message: `Agent ${agentId}: ${content.slice(0, 100)}`,
                  agentId,
                  timestamp: obj.timestamp ?? new Date().toISOString(),
                  source: 'session',
                });
              }
            }
          } catch { /* skip */ }
        });
        rl.on('close', resolve);
        rl.on('error', resolve);
      });
    }
  }

  return notifications;
}

// GET /api/notifications — return recent important events
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [gwNotifs, sessNotifs] = await Promise.all([parseGatewayLogs(300), parseSessionErrors()]);

    const all = [...gwNotifs, ...sessNotifs]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100); // cap at 100

    const counts = {
      error: all.filter((n) => n.level === 'error').length,
      warn: all.filter((n) => n.level === 'warn').length,
      total: all.length,
    };

    res.json({ notifications: all, counts });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
