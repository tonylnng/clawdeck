'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RefreshCw, Trash2, Search, Filter, Clock, HardDrive,
  MessageSquare, AlertTriangle, CheckSquare, Square, X,
} from 'lucide-react';

interface SessionEntry {
  key: string;
  label: string;
  model?: string;
  channel?: string;
  updatedAt?: string;
  createdAt?: string;
  sizeBytes?: number;
}

function relativeTime(ts?: string): string {
  if (!ts) return 'unknown';
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getDaysOld(ts?: string): number {
  if (!ts) return 0;
  return Math.floor((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24));
}

function channelBadgeStyle(channel?: string): string {
  switch ((channel ?? '').toLowerCase()) {
    case 'telegram': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'whatsapp': return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'discord': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
    case 'main': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    default: return 'bg-muted text-muted-foreground';
  }
}

function ConfirmDialog({ sessions, onConfirm, onCancel }: { sessions: SessionEntry[]; onConfirm: () => void; onCancel: () => void }) {
  const isBulk = sessions.length > 1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-card border rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-destructive/10 flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{isBulk ? `Delete ${sessions.length} sessions?` : 'Delete session?'}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {isBulk ? 'This will permanently delete the selected sessions and their message history.' : 'This will permanently delete this session and its message history.'}
            </p>
          </div>
        </div>
        <div className="bg-muted/50 rounded-md p-3 max-h-40 overflow-y-auto space-y-1.5">
          {sessions.map((s) => (
            <div key={s.key} className="text-xs font-mono text-muted-foreground flex items-center justify-between gap-2">
              <span className="truncate">{s.key}</span>
              <span className="text-muted-foreground/60 flex-shrink-0">{relativeTime(s.updatedAt)} · {formatSize(s.sizeBytes)}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {isBulk ? `Delete ${sessions.length} sessions` : 'Delete session'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterDays, setFilterDays] = useState<number | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmTarget, setConfirmTarget] = useState<SessionEntry[] | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' });
      if (res.status === 401) { router.push('/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionEntry[] };
      setSessions(data.sessions ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const agentIds = Array.from(new Set(sessions.map((s) => s.key.split(':')[1]).filter((x): x is string => Boolean(x)))).sort();

  const filtered = sessions.filter((s) => {
    if (filterAgent !== 'all' && s.key.split(':')[1] !== filterAgent) return false;
    if (filterDays !== null && getDaysOld(s.updatedAt) < filterDays) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!s.key.toLowerCase().includes(q) && !(s.label ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.key));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((s) => s.key)));
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const requestDelete = (targets: SessionEntry[]) => setConfirmTarget(targets);

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setConfirmTarget(null);
    const keys = confirmTarget.map((s) => s.key);
    setDeleting(new Set(keys));
    await Promise.all(keys.map((key) => fetch(`/api/sessions/${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'include' }).catch(() => null)));
    setSessions((prev) => prev.filter((s) => !keys.includes(s.key)));
    setSelected((prev) => { const next = new Set(prev); keys.forEach((k) => next.delete(k)); return next; });
    setDeleting(new Set());
  };

  const totalSize = sessions.reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0);
  const oldSessions = sessions.filter((s) => getDaysOld(s.updatedAt) >= 30);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {confirmTarget && <ConfirmDialog sessions={confirmTarget} onConfirm={confirmDelete} onCancel={() => setConfirmTarget(null)} />}

      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold">🗂️ Session Manager</h1>
          <p className="text-xs text-muted-foreground">Browse, filter and delete sessions across all agents</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <span className="text-xs text-muted-foreground hidden sm:block"><Clock className="h-3 w-3 inline mr-1" />{lastUpdated.toLocaleTimeString()}</span>}
          <Button variant="outline" size="sm" onClick={fetchSessions} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">{error}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Sessions', value: sessions.length, icon: <MessageSquare className="h-3.5 w-3.5" /> },
            { label: 'Total Size', value: formatSize(totalSize), icon: <HardDrive className="h-3.5 w-3.5" /> },
            { label: 'Inactive 30d+', value: oldSessions.length, icon: <Clock className="h-3.5 w-3.5" />, warn: oldSessions.length > 0 },
            { label: 'Agents', value: agentIds.length, icon: <Filter className="h-3.5 w-3.5" /> },
          ].map((stat) => (
            <Card key={stat.label}><CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">{stat.icon}<span className="text-xs">{stat.label}</span></div>
              <div className={`text-lg font-bold ${stat.warn ? 'text-amber-500' : ''}`}>{stat.value}</div>
            </CardContent></Card>
          ))}
        </div>

        {oldSessions.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{oldSessions.length} sessions inactive for 30+ days</span>
            <Button variant="outline" size="sm" className="h-6 text-xs px-2 ml-auto border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20" onClick={() => requestDelete(oldSessions)}>
              <Trash2 className="h-3 w-3 mr-1" />Clean up
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search sessions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          <select value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)} className="h-8 text-xs rounded-md border border-input bg-background px-2 pr-6 text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="all">All agents</option>
            {agentIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <select value={filterDays ?? ''} onChange={(e) => setFilterDays(e.target.value ? Number(e.target.value) : null)} className="h-8 text-xs rounded-md border border-input bg-background px-2 pr-6 text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">Any age</option>
            <option value="7">Inactive 7d+</option>
            <option value="14">Inactive 14d+</option>
            <option value="30">Inactive 30d+</option>
            <option value="90">Inactive 90d+</option>
          </select>
          {(search || filterDays || filterAgent !== 'all') && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => { setSearch(''); setFilterDays(null); setFilterAgent('all'); }}>
              <X className="h-3 w-3" />Clear
            </Button>
          )}
        </div>

        {someSelected && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/20 text-xs">
            <span className="font-medium">{selected.size} selected</span>
            <Button variant="destructive" size="sm" className="h-6 text-xs px-2 ml-auto" onClick={() => requestDelete(sessions.filter((s) => selected.has(s.key)))}>
              <Trash2 className="h-3 w-3 mr-1" />Delete selected
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">{loading ? 'Loading...' : 'No sessions found'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="px-4 py-2 w-8"><button onClick={toggleAll} className="flex items-center justify-center">{allSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}</button></th>
                      <th className="text-left px-4 py-2 font-medium">Session</th>
                      <th className="text-left px-4 py-2 font-medium">Channel</th>
                      <th className="text-left px-4 py-2 font-medium">Last Active</th>
                      <th className="text-left px-4 py-2 font-medium">Size</th>
                      <th className="text-left px-4 py-2 font-medium">Model</th>
                      <th className="px-4 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((session) => {
                      const agentId = session.key.split(':')[1] ?? '?';
                      const isOld = getDaysOld(session.updatedAt) >= 30;
                      const isDeleting = deleting.has(session.key);
                      const isSelected = selected.has(session.key);
                      return (
                        <tr key={session.key} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${isSelected ? 'bg-primary/5' : ''} ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}>
                          <td className="px-4 py-3 w-8"><button onClick={() => toggleOne(session.key)} className="flex items-center justify-center">{isSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}</button></td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-sm">{agentId}</div>
                            <div className="text-xs text-muted-foreground font-mono truncate max-w-[220px]" title={session.key}>{session.key}</div>
                          </td>
                          <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${channelBadgeStyle(session.channel)}`}>{session.channel ?? 'unknown'}</span></td>
                          <td className="px-4 py-3"><span className={`text-xs ${isOld ? 'text-amber-500' : 'text-muted-foreground'}`}>{relativeTime(session.updatedAt)}</span></td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{formatSize(session.sizeBytes)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono truncate max-w-[120px]">{session.model ? session.model.split('/').pop() : '—'}</td>
                          <td className="px-4 py-3"><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => requestDelete([session])} disabled={isDeleting}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">Showing {filtered.length} of {sessions.length} sessions · Deleting a session removes its message history permanently</p>
      </div>
    </div>
  );
}
