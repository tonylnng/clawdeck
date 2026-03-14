'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Radio, Bot, Clock, Hash, MessageSquare, Zap } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionInfo {
  key: string;
  agentId: string;
  channel: string;
  sessionSuffix: string;
  model?: string;
  updatedAt?: number;
  createdAt?: number;
  messageCount?: number;
  lastPing?: string; // relative time string
  isRecent: boolean; // active in last 5 min
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts?: number): string {
  if (!ts) return 'unknown';
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function shortModel(model?: string): string {
  if (!model) return '—';
  const parts = model.split('/');
  return parts[parts.length - 1] ?? model;
}

function channelBadgeStyle(channel: string): string {
  switch (channel.toLowerCase()) {
    case 'telegram': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'whatsapp': return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'discord': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
    case 'slack': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
    case 'main': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    default: return 'bg-muted text-muted-foreground';
  }
}

const AGENT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#eab308'];

// ─── Session Row ──────────────────────────────────────────────────────────────

function SessionRow({ session, agentColorMap }: { session: SessionInfo; agentColorMap: Map<string, string> }) {
  const color = agentColorMap.get(session.agentId) ?? '#94a3b8';

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ background: color }} />
          <span className="font-medium text-sm">{session.agentId}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${channelBadgeStyle(session.channel)}`}>
          {session.channel}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground font-mono max-w-[180px] truncate" title={session.key}>
        {session.sessionSuffix || session.key}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
        {shortModel(session.model)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {session.isRecent && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" title="Active in last 5 minutes" />
          )}
          <span className="text-xs text-muted-foreground">{relativeTime(session.updatedAt)}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-right tabular-nums text-muted-foreground">
        {session.messageCount ?? '—'}
      </td>
    </tr>
  );
}

// ─── Agent Summary Card ───────────────────────────────────────────────────────

function AgentSummary({ agentId, sessions, color }: { agentId: string; sessions: SessionInfo[]; color: string }) {
  const activeSessions = sessions.filter((s) => s.isRecent).length;
  const totalMessages = sessions.reduce((sum, s) => sum + (s.messageCount ?? 0), 0);
  const channels = Array.from(new Set(sessions.map((s) => s.channel)));

  return (
    <Card className="flex-1 min-w-[160px]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="font-semibold text-sm">{agentId}</span>
          {activeSessions > 0 && (
            <Badge className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-500/20 ml-auto">
              {activeSessions} live
            </Badge>
          )}
        </div>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><Hash className="h-3 w-3" />{sessions.length} sessions</div>
          <div className="flex items-center gap-1.5"><MessageSquare className="h-3 w-3" />{totalMessages} messages</div>
          <div className="flex items-center gap-1.5"><Radio className="h-3 w-3" />{channels.join(', ')}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<'all' | 'live'>('all');

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' });
      if (res.status === 401) { router.push('/login'); return; }
      if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);

      const data = await res.json() as { sessions: Array<{
        key: string; model?: string; updatedAt?: number; createdAt?: number; messageCount?: number;
      }> };

      const now = Date.now();
      const fiveMin = 5 * 60 * 1000;

      const parsed: SessionInfo[] = (data.sessions ?? [])
        .filter((s) => s.key.startsWith('agent:'))
        .map((s) => {
          const parts = s.key.split(':');
          const agentId = parts[1] ?? 'unknown';
          const channel = parts[2] ?? 'main';
          const sessionSuffix = parts.slice(3).join(':');
          const isRecent = s.updatedAt ? (now - s.updatedAt) < fiveMin : false;
          return { key: s.key, agentId, channel, sessionSuffix, model: s.model, updatedAt: s.updatedAt, createdAt: s.createdAt, messageCount: s.messageCount, isRecent };
        })
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      setSessions(parsed);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);
  useEffect(() => {
    const interval = setInterval(fetchSessions, 10_000); // poll every 10s
    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Build agent → color map
  const agentIds = Array.from(new Set(sessions.map((s) => s.agentId)));
  const agentColorMap = new Map(agentIds.map((id, idx) => [id, AGENT_COLORS[idx % AGENT_COLORS.length]]));

  // Agent groups for summary cards
  const agentGroups = new Map<string, SessionInfo[]>();
  sessions.forEach((s) => {
    const group = agentGroups.get(s.agentId) ?? [];
    group.push(s);
    agentGroups.set(s.agentId, group);
  });

  const liveSessions = sessions.filter((s) => s.isRecent);
  const displaySessions = filter === 'live' ? liveSessions : sessions;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold flex items-center gap-2">
            📡 Live Session Monitor
            {liveSessions.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {liveSessions.length} live
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">Real-time view of active sessions across all agents</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              <Clock className="h-3 w-3 inline mr-1" />
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchSessions} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 space-y-5">

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* Agent Summary Cards */}
        {agentGroups.size > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" />Agent Overview
            </h2>
            <div className="flex flex-wrap gap-3">
              {Array.from(agentGroups.entries()).map(([agentId, agentSessions]) => (
                <AgentSummary key={agentId} agentId={agentId} sessions={agentSessions} color={agentColorMap.get(agentId) ?? '#94a3b8'} />
              ))}
            </div>
          </section>
        )}

        {/* Session Table */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />All Sessions ({displaySessions.length})
            </h2>
            <div className="flex gap-1">
              <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setFilter('all')}>All</Button>
              <Button variant={filter === 'live' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setFilter('live')}>
                Live ({liveSessions.length})
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              {displaySessions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  {loading ? 'Loading sessions...' : filter === 'live' ? 'No active sessions in the last 5 minutes' : 'No sessions found'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-medium">Agent</th>
                        <th className="text-left px-4 py-2 font-medium">Channel</th>
                        <th className="text-left px-4 py-2 font-medium">Session</th>
                        <th className="text-left px-4 py-2 font-medium">Model</th>
                        <th className="text-left px-4 py-2 font-medium">Last Active</th>
                        <th className="text-right px-4 py-2 font-medium">Messages</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displaySessions.map((session) => (
                        <SessionRow key={session.key} session={session} agentColorMap={agentColorMap} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground mt-2">Auto-refreshes every 10 seconds. Sessions active in the last 5 minutes show a green pulse.</p>
        </section>
      </div>
    </div>
  );
}
