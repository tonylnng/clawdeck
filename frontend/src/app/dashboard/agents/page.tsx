'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, MessageSquare, Bot, AlertCircle, ChevronDown, ChevronUp, Cpu } from 'lucide-react';
import { InstanceFilterBar } from '@/components/federation/InstanceFilterBar';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  status?: string;
  model?: string;
  channel?: string;
  lastActive?: string;
  // Federation fields
  instanceId?: string;
  instanceName?: string;
  instanceColor?: string;
}

interface AgentsResponse {
  sessions?: Agent[];
  agents?: Agent[];
  [key: string]: unknown;
}

interface Instance {
  id: string;
  name: string;
  color: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'openrouter/anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'openrouter/anthropic/claude-opus-4-5', label: 'Claude Opus 4.5' },
  { value: 'openrouter/google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'openrouter/openai/gpt-4o', label: 'GPT-4o' },
  { value: 'openrouter/minimax/minimax-m2-5', label: 'MiniMax M2.5' },
] as const;

type ModelValue = typeof MODEL_OPTIONS[number]['value'];

const LS_MODEL_KEY = (agentId: string) => `clawdeck:model:${agentId}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status?: string) {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'online':
      return 'bg-green-500';
    case 'idle':
      return 'bg-yellow-500';
    case 'offline':
    case 'stopped':
    case 'inactive':
      return 'bg-gray-400';
    default:
      return 'bg-blue-500';
  }
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortModelName(value: string): string {
  const found = MODEL_OPTIONS.find((m) => m.value === value);
  return found ? found.label : value.split('/').pop() ?? value;
}

function getStoredModel(agentId: string): ModelValue {
  if (typeof window === 'undefined') return 'default';
  const stored = localStorage.getItem(LS_MODEL_KEY(agentId));
  if (stored && MODEL_OPTIONS.some((m) => m.value === stored)) {
    return stored as ModelValue;
  }
  return 'default';
}

function storeModel(agentId: string, model: ModelValue) {
  localStorage.setItem(LS_MODEL_KEY(agentId), model);
}

function normalizeAgentList(data: AgentsResponse): Agent[] {
  return (data.sessions || data.agents || (Array.isArray(data) ? data : [])) as Agent[];
}

// ── Agent Card ────────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: Agent;
  allAgents: Agent[];
  onOpenChat: (agentId: string) => void;
}

function AgentCard({ agent, allAgents, onOpenChat }: AgentCardProps) {
  const [selectedModel, setSelectedModel] = useState<ModelValue>('default');
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setSelectedModel(getStoredModel(agent.id));
  }, [agent.id]);

  const handleModelChange = (value: string) => {
    const model = value as ModelValue;
    setSelectedModel(model);
    storeModel(agent.id, model);
  };

  const sessionCount = allAgents.filter((a) => a.id === agent.id || a.name === agent.id).length;
  const channelsActive = agent.channel ? [agent.channel] : [];
  const isNonDefault = selectedModel !== 'default';
  const isRemote = Boolean(agent.instanceId);

  return (
    <Card className="hover:shadow-md transition-shadow flex flex-col overflow-hidden">
      {/* Instance badge strip for remote agents */}
      {isRemote && agent.instanceColor && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white"
          style={{ backgroundColor: agent.instanceColor }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
          {agent.instanceName ?? agent.instanceId}
        </div>
      )}

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${statusColor(agent.status)}`}
            />
            <CardTitle className="text-base truncate">{agent.name || agent.id}</CardTitle>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isRemote && (
              <span title="Remote instance" className="text-muted-foreground">🌐</span>
            )}
            {agent.status && (
              <Badge variant="secondary" className="text-xs capitalize">
                {agent.status}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 flex flex-col gap-3 flex-1">
        {/* Agent info */}
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="truncate">
            <span className="font-medium">ID:</span> {agent.id}
          </p>
          {agent.channel && (
            <p className="truncate">
              <span className="font-medium">Channel:</span> {agent.channel}
            </p>
          )}
          {agent.lastActive && (
            <p className="truncate">
              <span className="font-medium">Last active:</span>{' '}
              {new Date(agent.lastActive).toLocaleString()}
            </p>
          )}
        </div>

        {/* Model Switcher — only for local agents */}
        {!isRemote && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />
              Model
            </div>
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full text-xs border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {isNonDefault && (
              <Badge
                variant="outline"
                className="text-xs font-mono truncate max-w-full"
                title={selectedModel}
              >
                {shortModelName(selectedModel)}
              </Badge>
            )}
          </div>
        )}

        {/* Health Details toggle */}
        <div>
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {detailsOpen
              ? <ChevronUp className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
            Details
          </button>

          {detailsOpen && (
            <div className="mt-2 rounded-md border bg-muted/40 p-2.5 space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span className="font-medium">Sessions</span>
                <span>{sessionCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Channels active</span>
                <span>
                  {channelsActive.length > 0 ? channelsActive.join(', ') : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Last active</span>
                <span>{formatRelativeTime(agent.lastActive)}</span>
              </div>
              {agent.model && (
                <div className="flex justify-between">
                  <span className="font-medium">Current model</span>
                  <span className="truncate max-w-[140px] text-right" title={agent.model}>
                    {agent.model.split('/').pop() ?? agent.model}
                  </span>
                </div>
              )}
              {isRemote && agent.instanceName && (
                <div className="flex justify-between">
                  <span className="font-medium">Instance</span>
                  <span>{agent.instanceName}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat button — pushed to bottom */}
        {!isRemote && (
          <div className="mt-auto pt-1">
            <Button
              size="sm"
              className="w-full"
              onClick={() => onOpenChat(agent.id)}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Open Chat
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [instanceFilter, setInstanceFilter] = useState<string>('local');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [newAgentToast, setNewAgentToast] = useState<string | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevAgentIdsRef = useRef<Set<string>>(new Set());

  const fetchAgents = useCallback(async (filter: string, silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      let list: Agent[] = [];

      if (filter === 'local') {
        // Fetch session-based agents
        const res = await fetch('/api/agents', { credentials: 'include' });
        if (res.status === 401) { router.push('/login'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AgentsResponse = await res.json();
        list = normalizeAgentList(data);

        // Also fetch scan results (agents with dirs but no active session)
        try {
          const scanRes = await fetch('/api/agents/scan', { credentials: 'include' });
          if (scanRes.ok) {
            const scanData: AgentsResponse = await scanRes.json();
            const scanAgents = normalizeAgentList(scanData).map((a) => ({
              ...a,
              status: a.status ?? 'inactive',
            }));
            // Merge: don't duplicate by id
            const existingIds = new Set(list.map((a) => a.id));
            for (const sa of scanAgents) {
              if (!existingIds.has(sa.id)) {
                list.push(sa);
              }
            }
          }
        } catch { /* scan is best-effort */ }

      } else if (filter === 'all') {
        // Fetch local
        const localRes = await fetch('/api/agents', { credentials: 'include' });
        if (localRes.status === 401) { router.push('/login'); return; }
        let localAgents: Agent[] = [];
        if (localRes.ok) {
          const data: AgentsResponse = await localRes.json();
          localAgents = normalizeAgentList(data);
        }
        list.push(...localAgents);

        // Fetch all instances in parallel
        const instRes = await fetch('/api/instances', { credentials: 'include' });
        if (instRes.ok) {
          const instData = await instRes.json() as { instances?: Instance[] };
          const instances = instData.instances ?? [];
          const results = await Promise.allSettled(
            instances.map((inst) =>
              fetch(`/api/instances/${inst.id}/agents`, { credentials: 'include' })
                .then((r) => r.ok ? r.json() as Promise<AgentsResponse> : Promise.reject(r.status))
                .then((d) =>
                  normalizeAgentList(d).map((a) => ({
                    ...a,
                    instanceId: inst.id,
                    instanceName: inst.name,
                    instanceColor: inst.color,
                  }))
                )
            )
          );
          for (const result of results) {
            if (result.status === 'fulfilled') {
              list.push(...result.value);
            }
          }
        }

      } else {
        // Specific instance
        const res = await fetch(`/api/instances/${filter}/agents`, { credentials: 'include' });
        if (res.status === 401) { router.push('/login'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AgentsResponse = await res.json();

        // We need the instance name/color too
        let instanceName: string | undefined;
        let instanceColor: string | undefined;
        try {
          const instRes = await fetch('/api/instances', { credentials: 'include' });
          if (instRes.ok) {
            const instData = await instRes.json() as { instances?: Instance[] };
            const found = (instData.instances ?? []).find((i) => i.id === filter);
            instanceName = found?.name;
            instanceColor = found?.color;
          }
        } catch { /* best effort */ }

        list = normalizeAgentList(data).map((a) => ({
          ...a,
          instanceId: filter,
          instanceName,
          instanceColor,
        }));
      }

      // Auto-refresh: detect new agents
      if (silent) {
        const newIds = new Set(list.map((a) => a.id));
        const added: string[] = [];
        for (const id of newIds) {
          if (!prevAgentIdsRef.current.has(id)) added.push(id);
        }
        if (added.length > 0) {
          setNewAgentToast(`${added.length} new agent${added.length > 1 ? 's' : ''} detected`);
          setTimeout(() => setNewAgentToast(null), 4000);
        }
      }
      prevAgentIdsRef.current = new Set(list.map((a) => a.id));

      setAgents(list);
      setLastRefresh(new Date());
    } catch (err) {
      setError(String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [router]);

  // Fetch on filter change
  useEffect(() => {
    fetchAgents(instanceFilter);
  }, [instanceFilter, fetchAgents]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(() => {
        fetchAgents(instanceFilter, true);
      }, 30000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, instanceFilter, fetchAgents]);

  const openChat = (agentId: string) => {
    router.push(`/dashboard/chat?agent=${encodeURIComponent(agentId)}`);
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Agents</h1>
            {lastRefresh && (
              <p className="text-sm text-muted-foreground mt-1">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Auto-refresh toggle */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh (30s)
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchAgents(instanceFilter)}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Instance Filter Bar */}
        <InstanceFilterBar
          value={instanceFilter}
          onChange={(v) => setInstanceFilter(v)}
          className="mb-6"
        />

        {/* Auto-refresh toast */}
        {newAgentToast && (
          <div className="flex items-center gap-2 px-4 py-2 mb-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 text-sm">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {newAgentToast}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-4 mb-4 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Failed to load agents</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {loading && agents.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-muted rounded w-3/4 mb-3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : agents.length === 0 && !error ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bot className="h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">No agents found</p>
              <p className="text-sm mt-1">
                {instanceFilter === 'local'
                  ? 'No active OpenClaw sessions detected'
                  : 'No agents found for the selected instance(s)'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={`${agent.instanceId ?? 'local'}:${agent.id}`}
                agent={agent}
                allAgents={agents}
                onOpenChat={openChat}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
