'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  RefreshCw, Bot, MessageSquare, Hash, Cpu, TrendingUp,
  AlertTriangle, DollarSign, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, Legend,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentUsage {
  id: string;
  sessions: number;
  messages: number;
  estimatedTokens: number;
}

interface UsageData {
  agents: AgentUsage[];
  totalSessions: number;
  totalMessages: number;
  period: string;
}

interface ModelUsage {
  model: string;
  agents: string[];
  sessions: number;
}

interface ModelsData {
  models: ModelUsage[];
}

interface TimeseriesDay {
  date: string;
  agents: Record<string, { tokens: number; cost: number }>;
}

interface TimeseriesData {
  series: TimeseriesDay[];
  agentIds: string[];
}

interface ErrorBucket {
  date: string;
  categories: Record<string, number>;
  total: number;
}

interface ErrorsData {
  buckets: ErrorBucket[];
  total: number;
}

interface LatencyData {
  modelHeatmap: Record<string, (number | null)[]>;
  agentHeatmap: Record<string, (number | null)[]>;
  hours: number[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function shortModel(model: string): string {
  const parts = model.split('/');
  return parts[parts.length - 1] ?? model;
}

function shortDate(date: string): string {
  // YYYY-MM-DD → MM/DD
  const parts = date.split('-');
  return `${parts[1]}/${parts[2]}`;
}

// Chart colours per agent (matches group chat colors)
const AGENT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#eab308'];

// Error category colors
const ERROR_COLORS: Record<string, string> = {
  'Rate Limit (429)': '#f59e0b',
  'Region Block (403)': '#ef4444',
  'Timeout': '#8b5cf6',
  '5xx Error': '#dc2626',
  'Tool Failure': '#f97316',
  'Warning': '#6b7280',
  'Other': '#94a3b8',
};

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ title, value, icon, sub }: {
  title: string; value: string; icon: React.ReactNode; sub?: string;
}) {
  return (
    <Card className="flex-1 min-w-[140px]">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
          {icon}{title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-2xl font-bold leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Token Bar Chart (existing) ───────────────────────────────────────────────

function TokenBarChart({ agents }: { agents: AgentUsage[] }) {
  const data = agents
    .slice()
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
    .map((a) => ({ name: a.id, tokens: a.estimatedTokens }));

  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No data</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <YAxis tickFormatter={(v) => formatNumber(v)} tick={{ fontSize: 10 }} className="fill-muted-foreground" width={44} />
        <Tooltip
          formatter={(value) => [formatNumber(Number(value)), 'Est. Tokens']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
        />
        <Bar dataKey="tokens" radius={[4, 4, 0, 0]}>
          {data.map((_, idx) => <Cell key={idx} fill={AGENT_COLORS[idx % AGENT_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Token Over Time Chart ────────────────────────────────────────────────────

function TimeseriesChart({ data, agentIds, metric }: {
  data: TimeseriesDay[];
  agentIds: string[];
  metric: 'tokens' | 'cost';
}) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No historical data found in session files</p>;

  const chartData = data.map((day) => {
    const row: Record<string, string | number> = { date: shortDate(day.date) };
    agentIds.forEach((agentId) => {
      row[agentId] = day.agents[agentId]?.[metric] ?? 0;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
        <YAxis
          tickFormatter={(v) => metric === 'cost' ? formatCost(v) : formatNumber(v)}
          tick={{ fontSize: 10 }}
          className="fill-muted-foreground"
          width={metric === 'cost' ? 52 : 44}
        />
        <Tooltip
          formatter={(value, name) => [
            metric === 'cost' ? formatCost(Number(value)) : formatNumber(Number(value)),
            String(name),
          ]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {agentIds.map((agentId, idx) => (
          <Line
            key={agentId}
            type="monotone"
            dataKey={agentId}
            stroke={AGENT_COLORS[idx % AGENT_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Error Rate Chart ─────────────────────────────────────────────────────────

function ErrorChart({ data }: { data: ErrorBucket[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No error logs found</p>;

  // Collect all categories
  const categories = Array.from(new Set(data.flatMap((d) => Object.keys(d.categories))));

  const chartData = data.map((bucket) => {
    const row: Record<string, string | number> = { date: shortDate(bucket.date) };
    categories.forEach((cat) => { row[cat] = bucket.categories[cat] ?? 0; });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" width={30} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {categories.map((cat) => (
          <Bar key={cat} dataKey={cat} stackId="a" fill={ERROR_COLORS[cat] ?? '#94a3b8'} radius={categories[categories.length - 1] === cat ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Latency Heatmap ──────────────────────────────────────────────────────────

function latencyColor(ms: number | null): string {
  if (ms === null) return 'bg-muted/30';
  if (ms < 2000) return 'bg-green-500';
  if (ms < 5000) return 'bg-yellow-400';
  if (ms < 10000) return 'bg-orange-500';
  return 'bg-red-500';
}

function latencyOpacity(ms: number | null, max: number): string {
  if (ms === null || max === 0) return 'opacity-10';
  const ratio = Math.min(ms / max, 1);
  if (ratio < 0.2) return 'opacity-20';
  if (ratio < 0.4) return 'opacity-40';
  if (ratio < 0.6) return 'opacity-60';
  if (ratio < 0.8) return 'opacity-80';
  return 'opacity-100';
}

function LatencyHeatmap({ data, label }: { data: Record<string, (number | null)[]>; label: string }) {
  const rows = Object.entries(data);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No latency data — requires message exchanges in session files</p>;

  const allValues = rows.flatMap(([, row]) => row).filter((v): v is number => v !== null);
  const maxMs = allValues.length > 0 ? Math.max(...allValues) : 1;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour labels */}
        <div className="flex items-center mb-1">
          <div className="w-28 flex-shrink-0" />
          <div className="flex flex-1 gap-px">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground">{h % 6 === 0 ? `${h}h` : ''}</div>
            ))}
          </div>
        </div>
        {/* Rows */}
        {rows.map(([name, row]) => (
          <div key={name} className="flex items-center gap-1 mb-1">
            <div className="w-28 flex-shrink-0 text-xs font-mono text-muted-foreground truncate text-right pr-2">{name}</div>
            <div className="flex flex-1 gap-px">
              {row.map((ms, h) => (
                <div
                  key={h}
                  className={`flex-1 h-6 rounded-sm ${latencyColor(ms)} ${latencyOpacity(ms, maxMs)} cursor-default transition-opacity`}
                  title={ms !== null ? `${name} at ${h}:00 — avg ${ms}ms (${(ms/1000).toFixed(1)}s)` : `${name} at ${h}:00 — no data`}
                />
              ))}
            </div>
          </div>
        ))}
        {/* Legend */}
        <div className="flex items-center gap-3 mt-2 pl-28">
          {[['< 2s', 'bg-green-500'], ['2–5s', 'bg-yellow-400'], ['5–10s', 'bg-orange-500'], ['> 10s', 'bg-red-500'], ['No data', 'bg-muted/30']].map(([label, cls]) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded-sm ${cls}`} />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2 pl-28">Hover cells for exact latency. {label} · UTC hours.</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter();

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(null);
  const [errors, setErrors] = useState<ErrorsData | null>(null);
  const [latency, setLatency] = useState<LatencyData | null>(null);
  const [latencyView, setLatencyView] = useState<'model' | 'agent'>('model');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeMetric, setTimeMetric] = useState<'tokens' | 'cost'>('tokens');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageRes, modelsRes, tsRes, errRes, latRes] = await Promise.all([
        fetch('/api/analytics/usage', { credentials: 'include' }),
        fetch('/api/analytics/models', { credentials: 'include' }),
        fetch('/api/analytics/timeseries', { credentials: 'include' }),
        fetch('/api/analytics/errors', { credentials: 'include' }),
        fetch('/api/analytics/latency', { credentials: 'include' }),
      ]);

      if (usageRes.status === 401) { router.push('/login'); return; }

      const [usageData, modelsData, tsData, errData, latData] = await Promise.all([
        usageRes.ok ? usageRes.json() as Promise<UsageData> : Promise.resolve(null),
        modelsRes.ok ? modelsRes.json() as Promise<ModelsData> : Promise.resolve(null),
        tsRes.ok ? tsRes.json() as Promise<TimeseriesData> : Promise.resolve(null),
        errRes.ok ? errRes.json() as Promise<ErrorsData> : Promise.resolve(null),
        latRes.ok ? latRes.json() as Promise<LatencyData> : Promise.resolve(null),
      ]);

      setUsage(usageData);
      setModels(modelsData);
      setTimeseries(tsData);
      setErrors(errData);
      setLatency(latData);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const topModel = models?.models[0] ? shortModel(models.models[0].model) : '—';
  const activeAgents = usage?.agents.length ?? 0;
  const totalCost = timeseries?.series.reduce((sum, day) => {
    return sum + Object.values(day.agents).reduce((s, a) => s + a.cost, 0);
  }, 0) ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold">📊 Analytics</h1>
          <p className="text-xs text-muted-foreground">Token usage, cost & error tracking</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 space-y-6">

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* Summary Cards */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Overview</h2>
          <div className="flex flex-wrap gap-3">
            <SummaryCard title="Total Sessions" value={usage ? formatNumber(usage.totalSessions) : '—'} icon={<Hash className="h-3.5 w-3.5" />} sub={usage?.period} />
            <SummaryCard title="Total Messages" value={usage ? formatNumber(usage.totalMessages) : '—'} icon={<MessageSquare className="h-3.5 w-3.5" />} />
            <SummaryCard title="Active Agents" value={usage ? String(activeAgents) : '—'} icon={<Bot className="h-3.5 w-3.5" />} />
            <SummaryCard title="Top Model" value={topModel} icon={<Cpu className="h-3.5 w-3.5" />} sub={models?.models[0] ? `${models.models[0].sessions} sessions` : undefined} />
            <SummaryCard title="Total Cost (30d)" value={totalCost > 0 ? formatCost(totalCost) : '—'} icon={<DollarSign className="h-3.5 w-3.5" />} sub="from session files" />
          </div>
        </section>

        {/* Token Over Time */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Usage Over Time (30 days)
            </h2>
            <div className="flex gap-1">
              <Button variant={timeMetric === 'tokens' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setTimeMetric('tokens')}>Tokens</Button>
              <Button variant={timeMetric === 'cost' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setTimeMetric('cost')}>Cost</Button>
            </div>
          </div>
          <Card>
            <CardContent className="pt-4 px-4 pb-2">
              {!timeseries ? (
                <p className="text-sm text-muted-foreground text-center py-8">{loading ? 'Loading...' : 'No data'}</p>
              ) : (
                <TimeseriesChart data={timeseries.series} agentIds={timeseries.agentIds} metric={timeMetric} />
              )}
            </CardContent>
          </Card>
        </section>

        {/* Error Rate Dashboard */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Error Rate (last 7 days)
            </h2>
            {errors && errors.total > 0 && (
              <Badge variant="destructive" className="text-xs">{errors.total} total events</Badge>
            )}
          </div>
          <Card>
            <CardContent className="pt-4 px-4 pb-2">
              {!errors ? (
                <p className="text-sm text-muted-foreground text-center py-8">{loading ? 'Loading...' : 'No data'}</p>
              ) : (
                <>
                  <ErrorChart data={errors.buckets} />
                  {errors.buckets.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Breakdown by type</p>
                      <div className="flex flex-wrap gap-2">
                        {Array.from(
                          errors.buckets.reduce((map, bucket) => {
                            Object.entries(bucket.categories).forEach(([cat, count]) => {
                              map.set(cat, (map.get(cat) ?? 0) + count);
                            });
                            return map;
                          }, new Map<string, number>())
                        ).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                          <Badge key={cat} variant="outline" className="text-xs gap-1" style={{ borderColor: ERROR_COLORS[cat] ?? '#94a3b8', color: ERROR_COLORS[cat] ?? '#94a3b8' }}>
                            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: ERROR_COLORS[cat] ?? '#94a3b8' }} />
                            {cat}: {count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Token Usage by Agent (bar) */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Token Usage by Agent (all-time)
          </h2>
          <Card>
            <CardContent className="pt-4 px-4 pb-2">
              {!usage || usage.agents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{loading ? 'Loading...' : 'No agent data available'}</p>
              ) : (
                <TokenBarChart agents={usage.agents} />
              )}
            </CardContent>
          </Card>
        </section>

        {/* Agent Usage Table */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Agent Usage</h2>
          <Card>
            <CardContent className="p-0">
              {!usage || usage.agents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{loading ? 'Loading...' : 'No agent data available'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-medium">Agent</th>
                        <th className="text-right px-4 py-2 font-medium">Sessions</th>
                        <th className="text-right px-4 py-2 font-medium">Messages</th>
                        <th className="text-right px-4 py-2 font-medium">Est. Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.agents.slice().sort((a, b) => b.estimatedTokens - a.estimatedTokens).map((agent, idx) => (
                        <tr key={agent.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: AGENT_COLORS[idx % AGENT_COLORS.length] }} />
                              <span className="font-medium">{agent.id}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(agent.sessions)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(agent.messages)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <Badge variant="secondary" className="font-mono text-xs">{formatNumber(agent.estimatedTokens)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Model Distribution */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Model Distribution</h2>
          <Card>
            <CardContent className="p-4">
              {!models || models.models.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{loading ? 'Loading...' : 'No model data available'}</p>
              ) : (
                <ul className="space-y-3">
                  {models.models.map((m) => (
                    <li key={m.model} className="flex items-start gap-3">
                      <Cpu className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium font-mono truncate">{shortModel(m.model)}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{m.sessions} session{m.sessions !== 1 ? 's' : ''}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {m.model !== shortModel(m.model) && <span className="mr-2 opacity-60">{m.model}</span>}
                          Used by: {m.agents.map((a, i) => (
                            <span key={a}><span className="font-medium text-foreground">{a}</span>{i < m.agents.length - 1 && ', '}</span>
                          ))}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Latency Heatmap */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Response Latency Heatmap (by hour)
            </h2>
            <div className="flex gap-1">
              <Button variant={latencyView === 'model' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setLatencyView('model')}>By Model</Button>
              <Button variant={latencyView === 'agent' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setLatencyView('agent')}>By Agent</Button>
            </div>
          </div>
          <Card>
            <CardContent className="pt-4 px-4 pb-4">
              {!latency ? (
                <p className="text-sm text-muted-foreground text-center py-8">{loading ? 'Loading...' : 'No data'}</p>
              ) : (
                <LatencyHeatmap
                  data={latencyView === 'model' ? latency.modelHeatmap : latency.agentHeatmap}
                  label={latencyView === 'model' ? 'Per model' : 'Per agent'}
                />
              )}
            </CardContent>
          </Card>
        </section>

        <p className="text-xs text-muted-foreground pb-2">
          Token counts are estimates (~150 tokens/message) when not reported by the gateway. Cost data from session .jsonl files. Auto-refreshes every 30s.
        </p>
      </div>
    </div>
  );
}
