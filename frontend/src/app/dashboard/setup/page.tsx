'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Terminal,
  KeyRound,
  ShieldCheck,
  Clock,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConfigStatus {
  agents: string[];
  workspaces: Record<string, string>;
  gatewayUrl: string;
  gatewayConfigured: boolean;
}

interface GatewayHealth {
  gateway: 'ok' | 'error' | 'unreachable' | 'unconfigured';
  status?: number;
  detail?: string;
}

type StepStatus = 'ok' | 'error' | 'pending' | 'loading';

interface Step {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

interface UsageStatsSummary {
  lastUsed?: string;
  errorCount?: number;
  lastFailureAt?: string;
}

interface AuthProfileSummary {
  name: string;
  provider: string;
  redactedKey: string;
  hasUsageStats: boolean;
  cooldownActive: boolean;
  usageStatsSummary: UsageStatsSummary | null;
}

interface AuthProfilesResponse {
  agentId: string;
  version: number;
  profiles: AuthProfileSummary[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT_IDS = ['main', 'tonic-ai-tech', 'tonic-ai-workflow'] as const;
type AgentId = typeof AGENT_IDS[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'ok':      return <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />;
    case 'error':   return <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />;
    case 'pending': return <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0" />;
    default:        return <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground flex-shrink-0" />;
  }
}

interface AlertBannerProps {
  type: 'success' | 'error';
  message: string;
  onDismiss: () => void;
}

function AlertBanner({ type, message, onDismiss }: AlertBannerProps) {
  return (
    <div
      className={`flex items-start justify-between gap-3 p-3 rounded-lg border text-sm ${
        type === 'success'
          ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
          : 'bg-destructive/10 border-destructive/30 text-destructive'
      }`}
    >
      <div className="flex items-center gap-2">
        {type === 'success'
          ? <CheckCircle className="h-4 w-4 flex-shrink-0" />
          : <XCircle className="h-4 w-4 flex-shrink-0" />}
        <span>{message}</span>
      </div>
      <button
        onClick={onDismiss}
        className="text-current opacity-60 hover:opacity-100 transition-opacity text-xs font-mono"
      >
        ✕
      </button>
    </div>
  );
}

// ── Auth Profile Panel ────────────────────────────────────────────────────────

interface AuthProfilePanelProps {
  agentId: AgentId;
}

function AuthProfilePanel({ agentId }: AuthProfilePanelProps) {
  const [data, setData] = useState<AuthProfilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAlert(null);
    try {
      const res = await fetch(`/api/auth-profiles/${agentId}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: AuthProfilesResponse = await res.json();
      setData(json);
    } catch (err) {
      setAlert({ type: 'error', message: String(err) });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const handleReset = async () => {
    if (!confirm(`Reset all cooldowns for agent "${agentId}"?\n\nThis will clear usageStats in auth-profiles.json. The change takes effect immediately.`)) {
      return;
    }
    setResetting(true);
    setAlert(null);
    try {
      const res = await fetch(`/api/auth-profiles/${agentId}/reset-cooldown`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setAlert({ type: 'success', message: body.message || 'Cooldown reset successfully.' });
      await load();
    } catch (err) {
      setAlert({ type: 'error', message: String(err) });
    } finally {
      setResetting(false);
    }
  };

  const hasCooldown = data?.profiles.some((p) => p.cooldownActive) ?? false;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {data ? `${data.profiles.length} profile(s)` : 'Loading…'}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading || resetting}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant={hasCooldown ? 'default' : 'outline'}
            size="sm"
            onClick={handleReset}
            disabled={resetting || loading}
            className={hasCooldown ? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500' : ''}
          >
            <ShieldCheck className={`h-3.5 w-3.5 mr-1.5 ${resetting ? 'animate-spin' : ''}`} />
            {resetting ? 'Resetting…' : 'Reset Cooldown'}
          </Button>
        </div>
      </div>

      {/* Alert */}
      {alert && (
        <AlertBanner
          type={alert.type}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* Profile list */}
      {loading && !data ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse h-20 bg-muted rounded-lg" />
          ))}
        </div>
      ) : data?.profiles && data.profiles.length > 0 ? (
        <div className="space-y-2">
          {data.profiles.map((profile) => (
            <div
              key={profile.name}
              className="border rounded-lg p-3 space-y-2"
            >
              {/* Row 1: name + badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-medium">{profile.name}</span>
                <Badge variant="secondary" className="text-xs capitalize">
                  {profile.provider}
                </Badge>
                {profile.cooldownActive ? (
                  <Badge className="text-xs bg-orange-500 hover:bg-orange-500 text-white">
                    ⚠ Cooldown Active
                  </Badge>
                ) : profile.hasUsageStats ? (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-500">
                    ✓ Clear
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    No Stats
                  </Badge>
                )}
              </div>

              {/* Row 2: redacted key */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="font-mono">{profile.redactedKey}</span>
              </div>

              {/* Row 3: usage stats detail */}
              {profile.usageStatsSummary && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pl-5">
                  {profile.usageStatsSummary.lastUsed && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last used: {formatRelativeTime(profile.usageStatsSummary.lastUsed)}
                    </span>
                  )}
                  {typeof profile.usageStatsSummary.errorCount === 'number' && (
                    <span>Errors: {profile.usageStatsSummary.errorCount}</span>
                  )}
                  {profile.usageStatsSummary.lastFailureAt && (
                    <span>Last fail: {formatRelativeTime(profile.usageStatsSummary.lastFailureAt)}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        !loading && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No profiles found for this agent.
          </p>
        )
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>('main');

  const check = useCallback(async () => {
    setConfigLoading(true);

    try {
      const [cfgRes, healthRes] = await Promise.all([
        fetch('/api/config', { credentials: 'include' }),
        fetch('/api/config/health', { credentials: 'include' }),
      ]);

      const cfg: ConfigStatus = cfgRes.ok ? await cfgRes.json() : null;
      const h: GatewayHealth = healthRes.ok ? await healthRes.json() : { gateway: 'unreachable' };

      setConfig(cfg);
      setHealth(h);

      const newSteps: Step[] = [
        {
          id: 'gateway-configured',
          label: 'OpenClaw Gateway URL configured',
          status: cfg?.gatewayConfigured ? 'ok' : 'error',
          detail: cfg?.gatewayUrl || 'Not set — add OPENCLAW_GATEWAY_URL to .env',
        },
        {
          id: 'gateway-reachable',
          label: 'Gateway reachable',
          status:
            h?.gateway === 'ok' ? 'ok' :
            h?.gateway === 'unconfigured' ? 'pending' : 'error',
          detail:
            h?.gateway === 'ok' ? cfg?.gatewayUrl :
            h?.gateway === 'unreachable' ? `Cannot reach ${cfg?.gatewayUrl || 'gateway'} — is OpenClaw running?` :
            h?.gateway === 'unconfigured' ? 'Configure gateway first' :
            `HTTP ${h?.status}`,
        },
        {
          id: 'agents',
          label: 'Agents configured',
          status: cfg?.agents?.length ? 'ok' : 'error',
          detail: cfg?.agents?.length
            ? `${cfg.agents.join(', ')}`
            : 'No agents found — set CLAWDECK_AGENTS in .env',
        },
        ...(cfg?.agents?.map((agentId) => ({
          id: `workspace-${agentId}`,
          label: `Workspace: ${agentId}`,
          status: (cfg.workspaces[agentId] ? 'ok' : 'error') as StepStatus,
          detail: cfg.workspaces[agentId] || `Set WORKSPACE_${agentId.toUpperCase().replace(/-/g, '_')} in .env`,
        })) || []),
      ];
      setSteps(newSteps);
    } catch {
      setSteps([{
        id: 'error',
        label: 'Cannot reach backend',
        status: 'error',
        detail: 'Make sure ClawDeck backend is running',
      }]);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  const allOk = steps.length > 0 && steps.every((s) => s.status === 'ok');

  return (
    <div className="h-full overflow-auto p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold">Setup & Status</h1>
          <p className="text-muted-foreground mt-1">
            Configuration checks, gateway status, and auth profile management.
          </p>
        </div>

        {/* ── Overall status banner ── */}
        {!configLoading && (
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${
            allOk
              ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
              : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
          }`}>
            {allOk
              ? <CheckCircle className="h-5 w-5 flex-shrink-0" />
              : <AlertCircle className="h-5 w-5 flex-shrink-0" />}
            <div>
              <p className="font-medium">
                {allOk ? 'Everything looks good!' : 'Action required'}
              </p>
              <p className="text-sm">
                {allOk
                  ? 'ClawDeck is fully configured and connected to OpenClaw.'
                  : 'Some configuration is missing. See details below.'}
              </p>
            </div>
          </div>
        )}

        {/* ── Config checks ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Configuration Checks</CardTitle>
              <Button variant="ghost" size="sm" onClick={check} disabled={configLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${configLoading ? 'animate-spin' : ''}`} />
                Re-check
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {configLoading && steps.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="h-5 w-5 bg-muted rounded-full flex-shrink-0" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                  </div>
                ))}
              </div>
            ) : (
              steps.map((step) => (
                <div key={step.id} className="flex items-start gap-3 py-1">
                  <StatusIcon status={step.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{step.label}</p>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 break-all">{step.detail}</p>
                    )}
                  </div>
                  {step.status === 'ok' && (
                    <Badge variant="secondary" className="ml-auto flex-shrink-0 text-xs">OK</Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* ── Auth Profile Editor ── */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  Auth Profile Editor
                </CardTitle>
                <CardDescription className="mt-1">
                  View API keys and reset rate-limit cooldowns per agent.
                </CardDescription>
              </div>
            </div>

            {/* Agent selector tabs */}
            <div className="flex gap-1 mt-3 border-b">
              {AGENT_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => setSelectedAgent(id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors ${
                    selectedAgent === id
                      ? 'bg-background border border-b-background text-foreground -mb-px'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <AuthProfilePanel key={selectedAgent} agentId={selectedAgent} />
          </CardContent>
        </Card>

        {/* ── Fix instructions (shown when broken) ── */}
        {!configLoading && !allOk && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                How to fix
              </CardTitle>
              <CardDescription>
                Run the installer to auto-configure, or edit .env manually.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Option 1 — Run the installer (recommended)</p>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto">
{`git clone https://github.com/tonylnng/clawdeck
cd clawdeck
bash install.sh`}
                </pre>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Option 2 — Edit .env manually</p>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto">
{`# Required settings in your .env:
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=<your-token-from-openclaw.json>
CLAWDECK_AGENTS=main,my-agent-2
WORKSPACE_MAIN=/home/user/.openclaw/workspace
WORKSPACE_MY_AGENT_2=/home/user/.openclaw/workspace-my-agent-2`}
                </pre>
                <p className="text-xs text-muted-foreground mt-2">
                  After editing .env, restart:{' '}
                  <code className="bg-muted px-1 rounded">docker compose up -d --build</code>
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Agent summary ── */}
        {config?.agents && config.agents.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configured Agents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {config.agents.map((agentId) => (
                  <div key={agentId} className="flex items-center justify-between text-sm">
                    <span className="font-mono">{agentId}</span>
                    <span className="text-muted-foreground text-xs truncate max-w-xs">
                      {config.workspaces[agentId] || 'workspace not set'}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Actions ── */}
        <div className="flex gap-3">
          {allOk && (
            <Button onClick={() => router.push('/dashboard/agents')}>
              Go to Agents →
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href="https://github.com/tonylnng/clawdeck" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              ClawDeck Docs
            </a>
          </Button>
        </div>

      </div>
    </div>
  );
}
