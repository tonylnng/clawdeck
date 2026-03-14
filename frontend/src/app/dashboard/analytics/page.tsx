'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Bot, MessageSquare, Hash, Cpu, TrendingUp } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortModel(model: string): string {
  const parts = model.split('/');
  return parts[parts.length - 1] ?? model;
}

// Chart colours per agent
const AGENT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

// ─── Summary Card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
}

function SummaryCard({ title, value, icon, sub }: SummaryCardProps) {
  return (
    <Card className="flex-1 min-w-[140px]">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-2xl font-bold leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Token Bar Chart ──────────────────────────────────────────────────────────

function TokenBarChart({ agents }: { agents: AgentUsage[] }) {
  const data = agents
    .slice()
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
    .map((a) => ({
      name: a.id,
      tokens: a.estimatedTokens,
      messages: a.messages,
      sessions: a.sessions,
    }));

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">No data</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
        />
        <YAxis
          tickFormatter={(v) => formatNumber(v)}
          tick={{ fontSize: 10 }}
          className="fill-muted-foreground"
          width={44}
        />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => [formatNumber(Number(value)), name === 'tokens' ? 'Est. Tokens' : name]}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--card))',
            color: 'hsl(var(--foreground))',
          }}
        />
        <Bar dataKey="tokens" radius={[4, 4, 0, 0]}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={AGENT_COLORS[idx % AGENT_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter();

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageRes, modelsRes] = await Promise.all([
        fetch('/api/analytics/usage', { credentials: 'include' }),
        fetch('/api/analytics/models', { credentials: 'include' }),
      ]);

      if (usageRes.status === 401 || modelsRes.status === 401) {
        router.push('/login');
        return;
      }

      if (!usageRes.ok || !modelsRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      const [usageData, modelsData] = await Promise.all([
        usageRes.json() as Promise<UsageData>,
        modelsRes.json() as Promise<ModelsData>,
      ]);

      setUsage(usageData);
      setModels(modelsData);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const topModel =
    models?.models[0] ? shortModel(models.models[0].model) : '—';
  const activeAgents = usage?.agents.length ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold">📊 Analytics</h1>
          <p className="text-xs text-muted-foreground">
            Token usage &amp; session stats
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={loading}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto p-4 space-y-6">

        {/* Error */}
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Overview
          </h2>
          <div className="flex flex-wrap gap-3">
            <SummaryCard
              title="Total Sessions"
              value={usage ? formatNumber(usage.totalSessions) : '—'}
              icon={<Hash className="h-3.5 w-3.5" />}
              sub={usage?.period}
            />
            <SummaryCard
              title="Total Messages"
              value={usage ? formatNumber(usage.totalMessages) : '—'}
              icon={<MessageSquare className="h-3.5 w-3.5" />}
            />
            <SummaryCard
              title="Active Agents"
              value={usage ? String(activeAgents) : '—'}
              icon={<Bot className="h-3.5 w-3.5" />}
            />
            <SummaryCard
              title="Top Model"
              value={topModel}
              icon={<Cpu className="h-3.5 w-3.5" />}
              sub={
                models?.models[0]
                  ? `${models.models[0].sessions} session${models.models[0].sessions !== 1 ? 's' : ''}`
                  : undefined
              }
            />
          </div>
        </section>

        {/* Token Usage Chart */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Token Usage by Agent
          </h2>
          <Card>
            <CardContent className="pt-4 px-4 pb-2">
              {!usage || usage.agents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {loading ? 'Loading...' : 'No agent data available'}
                </p>
              ) : (
                <TokenBarChart agents={usage.agents} />
              )}
            </CardContent>
          </Card>
        </section>

        {/* Agent Usage Table */}
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Agent Usage
          </h2>
          <Card>
            <CardContent className="p-0">
              {!usage || usage.agents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {loading ? 'Loading...' : 'No agent data available'}
                </p>
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
                      {usage.agents
                        .slice()
                        .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
                        .map((agent, idx) => (
                          <tr
                            key={agent.id}
                            className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${
                              idx % 2 === 0 ? '' : 'bg-muted/10'
                            }`}
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ background: AGENT_COLORS[idx % AGENT_COLORS.length] }}
                                />
                                <span className="font-medium">{agent.id}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {formatNumber(agent.sessions)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {formatNumber(agent.messages)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              <Badge variant="secondary" className="font-mono text-xs">
                                {formatNumber(agent.estimatedTokens)}
                              </Badge>
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
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Model Distribution
          </h2>
          <Card>
            <CardContent className="p-4">
              {!models || models.models.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {loading ? 'Loading...' : 'No model data available'}
                </p>
              ) : (
                <ul className="space-y-3">
                  {models.models.map((m) => (
                    <li key={m.model} className="flex items-start gap-3">
                      <Cpu className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium font-mono truncate">
                            {shortModel(m.model)}
                          </span>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {m.sessions} session{m.sessions !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {m.model !== shortModel(m.model) && (
                            <span className="mr-2 opacity-60">{m.model}</span>
                          )}
                          Used by:{' '}
                          {m.agents.map((a, i) => (
                            <span key={a}>
                              <span className="font-medium text-foreground">{a}</span>
                              {i < m.agents.length - 1 && ', '}
                            </span>
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

        {/* Footer note */}
        <p className="text-xs text-muted-foreground pb-2">
          Token counts are estimates (~150 tokens/message) when not reported by the gateway.
          Auto-refreshes every 30s.
        </p>
      </div>
    </div>
  );
}
