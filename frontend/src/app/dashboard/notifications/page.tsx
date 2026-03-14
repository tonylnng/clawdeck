'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, AlertCircle, Info, Clock, Filter } from 'lucide-react';

interface Notification {
  id: string;
  level: 'error' | 'warn' | 'info';
  category: string;
  message: string;
  agentId?: string;
  timestamp: string;
  source: 'gateway' | 'session';
}

interface NotifData {
  notifications: Notification[];
  counts: { error: number; warn: number; total: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Rate Limit': 'bg-amber-500/10 text-amber-700 border-amber-400/30 dark:text-amber-400',
  'Region Block': 'bg-red-500/10 text-red-700 border-red-400/30 dark:text-red-400',
  'Timeout': 'bg-purple-500/10 text-purple-700 border-purple-400/30 dark:text-purple-400',
  'Session Timeout': 'bg-purple-500/10 text-purple-700 border-purple-400/30 dark:text-purple-400',
  'Tool Failure': 'bg-orange-500/10 text-orange-700 border-orange-400/30 dark:text-orange-400',
  'Cooldown': 'bg-blue-500/10 text-blue-700 border-blue-400/30 dark:text-blue-400',
  'Error': 'bg-red-500/10 text-red-700 border-red-400/30 dark:text-red-400',
  'Warning': 'bg-gray-500/10 text-gray-700 border-gray-400/30 dark:text-gray-400',
};

function LevelIcon({ level }: { level: string }) {
  if (level === 'error') return <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />;
  if (level === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />;
  return <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />;
}

// ── Notification Row ──────────────────────────────────────────────────────────

function NotifRow({ notif }: { notif: Notification }) {
  const catStyle = CATEGORY_COLORS[notif.category] ?? 'bg-muted text-muted-foreground';

  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/20 transition-colors ${notif.level === 'error' ? 'border-l-2 border-l-red-500' : notif.level === 'warn' ? 'border-l-2 border-l-amber-500' : ''}`}>
      <LevelIcon level={notif.level} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${catStyle}`}>{notif.category}</Badge>
          {notif.agentId && <span className="text-[10px] font-mono text-muted-foreground">{notif.agentId}</span>}
          <span className="text-[10px] px-1.5 py-0 rounded bg-muted/60 text-muted-foreground">{notif.source}</span>
        </div>
        <p className="text-xs text-foreground/80 font-mono break-words">{notif.message}</p>
      </div>
      <div className="text-[10px] text-muted-foreground flex-shrink-0 flex items-center gap-1 mt-0.5">
        <Clock className="h-3 w-3" />
        {relativeTime(notif.timestamp)}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const router = useRouter();
  const [data, setData] = useState<NotifData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warn'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const fetchNotifs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' });
      if (res.status === 401) { router.push('/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as NotifData;
      setData(d);
      setLastUpdated(new Date());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchNotifs(); }, [fetchNotifs]);
  useEffect(() => {
    const interval = setInterval(fetchNotifs, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifs]);

  const allNotifs = data?.notifications ?? [];
  const categories = Array.from(new Set(allNotifs.map((n) => n.category)));

  const filtered = allNotifs.filter((n) => {
    if (levelFilter !== 'all' && n.level !== levelFilter) return false;
    if (categoryFilter !== 'all' && n.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold flex items-center gap-2">
            🔔 Notification Center
            {data && data.counts.error > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />{data.counts.error} errors
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">Events from all agents · last 3 days</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <span className="text-xs text-muted-foreground hidden sm:block">{lastUpdated.toLocaleTimeString()}</span>}
          <Button variant="outline" size="sm" onClick={fetchNotifs} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {error && <div className="m-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">{error}</div>}

        {/* Summary Cards */}
        {data && (
          <div className="flex gap-3 p-4 pb-0 flex-wrap">
            <div className="flex-1 min-w-[100px] rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold text-red-500">{data.counts.error}</p>
              <p className="text-xs text-muted-foreground mt-1">Errors</p>
            </div>
            <div className="flex-1 min-w-[100px] rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold text-amber-500">{data.counts.warn}</p>
              <p className="text-xs text-muted-foreground mt-1">Warnings</p>
            </div>
            <div className="flex-1 min-w-[100px] rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold">{data.counts.total}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Events</p>
            </div>
          </div>
        )}

        {/* Filters */}
        {allNotifs.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex gap-1">
              {(['all', 'error', 'warn'] as const).map((lvl) => (
                <Button key={lvl} variant={levelFilter === lvl ? 'default' : 'outline'} size="sm"
                  className="h-6 text-xs px-2" onClick={() => setLevelFilter(lvl)}>
                  {lvl === 'all' ? 'All' : lvl === 'error' ? '🔴 Errors' : '🟡 Warnings'}
                </Button>
              ))}
            </div>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-xs rounded-md border border-input bg-background px-2 py-1 focus:outline-none">
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-xs text-muted-foreground ml-auto">{filtered.length} events</span>
          </div>
        )}

        {/* Notifications list */}
        {loading && allNotifs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />Loading events...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
            <Info className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">{levelFilter !== 'all' || categoryFilter !== 'all' ? 'No events match your filters' : 'No events found in the last 3 days'}</p>
          </div>
        ) : (
          <Card className="m-4 overflow-hidden">
            <CardContent className="p-0">
              {filtered.map((n) => <NotifRow key={n.id} notif={n} />)}
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground px-4 pb-4">Auto-refreshes every 30 seconds. Sourced from gateway logs and session files.</p>
      </div>
    </div>
  );
}
