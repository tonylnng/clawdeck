import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth';
import { redactMiddleware } from '../middleware/redact';

const router = Router();

router.use(requireAuth);
router.use(redactMiddleware);

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

async function invokeGatewayTool(tool: string, args: Record<string, unknown> = {}, sessionKey?: string): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ tool, args, ...(sessionKey ? { sessionKey } : {}) }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  return res.json();
}

interface SessionEntry {
  key: string;
  model?: string;
  channel?: string;
  updatedAt?: number;
}

interface HistoryMessage {
  role: string;
  content: string;
  timestamp?: string | number;
}

interface SearchResult {
  sessionKey: string;
  agentId: string;
  role: string;
  content: string;
  matchedAt: string;
  preview: string;
}

function extractAgentId(sessionKey: string): string {
  const parts = sessionKey.split(':');
  return parts[1] || 'unknown';
}

function formatTimestamp(ts?: string | number): string {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return new Date(ts).toISOString();
}

// GET /api/search?q=&agent=&limit=
router.get('/', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
  const agentFilter = (req.query.agent as string || '').trim();
  const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);

  if (!query) {
    res.status(400).json({ error: 'Missing query parameter: q' });
    return;
  }

  try {
    // Get all sessions
    const raw = await invokeGatewayTool('sessions_list', {}) as {
      result?: { details?: { sessions?: SessionEntry[] } }
    };

    const sessions: SessionEntry[] = raw?.result?.details?.sessions ?? [];

    // Filter by agent if specified
    let filteredSessions = sessions.filter((s) => {
      const parts = s.key.split(':');
      return parts[0] === 'agent';
    });

    if (agentFilter) {
      filteredSessions = filteredSessions.filter((s) => {
        const agentId = extractAgentId(s.key);
        return agentId.startsWith(agentFilter);
      });
    }

    // Limit to 10 sessions max to avoid slow searches
    const sessionsToSearch = filteredSessions.slice(0, 10);

    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    // Search each session's history
    for (const session of sessionsToSearch) {
      if (results.length >= limit) break;

      try {
        const historyRaw = await invokeGatewayTool(
          'sessions_history',
          { sessionKey: session.key, limit: 20 },
          session.key
        ) as { result?: { messages?: HistoryMessage[]; details?: { messages?: HistoryMessage[] } } };

        const messages: HistoryMessage[] =
          historyRaw?.result?.messages ??
          historyRaw?.result?.details?.messages ??
          [];

        for (const msg of messages) {
          if (results.length >= limit) break;

          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          if (content.toLowerCase().includes(queryLower)) {
            results.push({
              sessionKey: session.key,
              agentId: extractAgentId(session.key),
              role: msg.role,
              content,
              matchedAt: formatTimestamp(msg.timestamp),
              preview: content.slice(0, 200),
            });
          }
        }
      } catch (sessionErr) {
        // Skip sessions that fail — continue with others
        console.warn(`Failed to fetch history for session ${session.key}:`, sessionErr);
      }
    }

    res.json({
      results,
      total: results.length,
      query,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(502).json({ error: 'Failed to search conversations', detail: String(err) });
  }
});

// GET /api/search/export/:sessionKey — export a session as Markdown download
router.get('/export/:sessionKey(*)', async (req: Request, res: Response) => {
  const { sessionKey } = req.params;

  if (!sessionKey) {
    res.status(400).json({ error: 'Missing sessionKey' });
    return;
  }

  try {
    const historyRaw = await invokeGatewayTool(
      'sessions_history',
      { sessionKey, limit: 200 },
      sessionKey
    ) as { result?: { messages?: HistoryMessage[]; details?: { messages?: HistoryMessage[] } } };

    const messages: HistoryMessage[] =
      historyRaw?.result?.messages ??
      historyRaw?.result?.details?.messages ??
      [];

    const agentId = extractAgentId(sessionKey);
    const exportedAt = new Date().toLocaleString('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).replace(',', '');

    const lines: string[] = [
      '# Conversation Export',
      '',
      `**Session:** ${sessionKey}`,
      `**Exported:** ${exportedAt}`,
      `**Agent:** ${agentId}`,
      '',
      '---',
      '',
    ];

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const ts = msg.timestamp
        ? new Date(msg.timestamp as string | number)
            .toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false })
            .replace(',', '')
        : '';

      lines.push(`**${role}**${ts ? ` · ${ts}` : ''}`);
      lines.push('');
      lines.push(content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    const markdown = lines.join('\n');

    // Sanitize sessionKey for filename
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_\-:.]/g, '_');
    const filename = `conversation-${safeKey}.md`;

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(markdown);
  } catch (err) {
    console.error('Export error:', err);
    res.status(502).json({ error: 'Failed to export conversation', detail: String(err) });
  }
});

export default router;
