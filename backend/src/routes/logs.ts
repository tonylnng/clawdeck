import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { requireAuth } from '../middleware/auth';
import { redactMiddleware, redactString } from '../middleware/redact';

const router = Router();

router.use(requireAuth);

function getLogFilePath(dateStr?: string): string {
  const date = dateStr || new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `/tmp/openclaw/openclaw-${date}.log`;
}

// Read last N lines of a file, optionally filtering by agentId
async function tailFile(filePath: string, lines: number, agentId?: string): Promise<string[]> {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      resolve([]);
      return;
    }

    const result: string[] = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      // Apply agentId filter if specified
      if (agentId) {
        if (!lineMatchesAgent(line, agentId)) return;
      }

      result.push(line);
      if (result.length > lines) {
        result.shift();
      }
    });

    rl.on('close', () => resolve(result));
    rl.on('error', () => resolve(result));
  });
}

// Check if a log line belongs to a given agentId
function lineMatchesAgent(line: string, agentId: string): boolean {
  try {
    const obj = JSON.parse(line);
    // Support various field names for agent id
    const lineAgentId = obj.agentId || obj.agent_id || obj.agent || obj.session;
    if (lineAgentId) {
      return String(lineAgentId).toLowerCase() === agentId.toLowerCase();
    }
    // Fallback: check if raw line contains the agentId string
    return line.toLowerCase().includes(agentId.toLowerCase());
  } catch {
    // Non-JSON line: substring match
    return line.toLowerCase().includes(agentId.toLowerCase());
  }
}

// GET /api/logs/gateway - last 200 lines of gateway log
router.get('/gateway', redactMiddleware, async (req: Request, res: Response) => {
  const logPath = getLogFilePath();
  const limit = parseInt(req.query.limit as string || '200', 10);

  try {
    const lines = await tailFile(logPath, limit);
    const parsed = lines.map(line => {
      try {
        return JSON.parse(redactString(line));
      } catch {
        return { raw: redactString(line) };
      }
    });

    res.json({ lines: parsed, path: logPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read log file', detail: String(err) });
  }
});

// GET /api/logs/agents/:id - recent session messages for an agent (from .jsonl files)
router.get('/agents/:id', redactMiddleware, async (req: Request, res: Response) => {
  const agentId = req.params.id;
  const limit = parseInt(req.query.limit as string || '200', 10);
  // OPENCLAW_HOME may be '/home/user' or '/home/user/.openclaw' — handle both
  const rawHome = process.env.OPENCLAW_HOME || '/home/tonic';
  const openclaw_home = rawHome.endsWith('.openclaw') ? rawHome : path.join(rawHome, '.openclaw');
  const sessionsDir = path.join(openclaw_home, 'agents', agentId, 'sessions');

  try {
    if (!fs.existsSync(sessionsDir)) {
      return res.json({ lines: [], agentId, source: 'sessions', note: `No sessions dir: ${sessionsDir}` });
    }

    // Find active .jsonl files (not deleted/reset), sorted by mtime desc
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted') && !f.includes('.reset'))
      .map(f => ({ name: f, path: path.join(sessionsDir, f), mtime: fs.statSync(path.join(sessionsDir, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .slice(0, 5); // Read last 5 sessions

    const allLines: { raw: string; level?: string; timestamp?: string; message?: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const fileLines = content.split('\n').filter(l => l.trim());
      for (const line of fileLines) {
        try {
          const obj = JSON.parse(line);
          // Only process message-type entries
          if (obj.type !== 'message') continue;
          const msg = obj.message || obj;
          const role = msg.role;
          if (!role || role === 'tool') continue;

          // Extract text content from various formats
          let content = '';
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content
              .filter((c: { type?: string; text?: string }) => c.type === 'text' && c.text)
              .map((c: { text: string }) => c.text)
              .join(' ');
          }
          if (!content.trim()) continue;

          const ts = obj.timestamp || '';
          allLines.push({
            raw: redactString(`[${role.toUpperCase()}] ${content.slice(0, 300)}`),
            level: role === 'assistant' ? 'info' : 'debug',
            timestamp: ts ? new Date(ts).toISOString() : undefined,
            message: redactString(content.slice(0, 300)),
          });
        } catch {
          // skip malformed lines
        }
      }
    }

    // Return last N lines
    const result = allLines.slice(-limit);
    res.json({ lines: result, agentId, source: 'sessions', sessionFiles: files.map(f => f.name) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read agent sessions', detail: String(err) });
  }
});

// SSE /api/logs/stream - real-time log streaming, optionally filtered by agentId
router.get('/stream', async (req: Request, res: Response) => {
  const agentId = req.query.agentId as string | undefined;
  const logPath = getLogFilePath();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send immediate connected event so browser onopen fires right away
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Send heartbeat more frequently to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 5000);

  // Send initial tail (50 lines)
  try {
    const initial = await tailFile(logPath, 50, agentId);
    for (const line of initial) {
      const redacted = redactString(line);
      const data = JSON.stringify({ type: 'line', data: redacted });
      res.write(`data: ${data}\n\n`);
    }
  } catch {
    // File may not exist yet
  }

  // Track file position
  let fileSize = 0;
  let currentLogPath = logPath;

  try {
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      fileSize = stat.size;
    }
  } catch {
    fileSize = 0;
  }

  let watcher: fs.FSWatcher | null = null;
  let watchTimer: NodeJS.Timeout | null = null;

  const processNewData = () => {
    try {
      if (!fs.existsSync(currentLogPath)) return;

      const stat = fs.statSync(currentLogPath);
      if (stat.size <= fileSize) return;

      const fd = fs.openSync(currentLogPath, 'r');
      const buffer = Buffer.alloc(stat.size - fileSize);
      fs.readSync(fd, buffer, 0, buffer.length, fileSize);
      fs.closeSync(fd);

      fileSize = stat.size;

      const text = buffer.toString('utf-8');
      const lines = text.split('\n').filter(l => l.trim());

      for (const line of lines) {
        // Apply agentId filter if specified
        if (agentId && !lineMatchesAgent(line, agentId)) continue;

        const redacted = redactString(line);
        const data = JSON.stringify({ type: 'line', data: redacted });
        res.write(`data: ${data}\n\n`);
      }
    } catch (err) {
      console.error('Log stream read error:', err);
    }
  };

  // Try fs.watch on directory
  try {
    if (fs.existsSync(path.dirname(currentLogPath))) {
      watcher = fs.watch(currentLogPath, { persistent: false }, () => {
        processNewData();
      });
    }
  } catch {
    // fallback to polling
  }

  // Polling fallback (also handles log rotation)
  watchTimer = setInterval(() => {
    // Check if date changed (log rotation)
    const newLogPath = getLogFilePath();
    if (newLogPath !== currentLogPath) {
      currentLogPath = newLogPath;
      fileSize = 0;
      res.write(`data: ${JSON.stringify({ type: 'rotate', path: newLogPath })}\n\n`);

      // Re-watch new file
      if (watcher) {
        try { watcher.close(); } catch { /* ignore */ }
        watcher = null;
      }
      try {
        if (fs.existsSync(path.dirname(currentLogPath))) {
          watcher = fs.watch(currentLogPath, { persistent: false }, processNewData);
        }
      } catch { /* fallback to polling */ }
    }
    processNewData();
  }, 2000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (watchTimer) clearInterval(watchTimer);
    if (watcher) {
      try { watcher.close(); } catch { /* ignore */ }
    }
  });
});

export default router;
