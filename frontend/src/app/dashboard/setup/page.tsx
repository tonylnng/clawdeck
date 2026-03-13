'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, ExternalLink, Terminal } from 'lucide-react';

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

export default function SetupPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);

  const check = async () => {
    setLoading(true);

    try {
      const [cfgRes, healthRes] = await Promise.all([
        fetch('/api/config', { credentials: 'include' }),
        fetch('/api/config/health', { credentials: 'include' }),
      ]);

      const cfg: ConfigStatus = cfgRes.ok ? await cfgRes.json() : null;
      const h: GatewayHealth = healthRes.ok ? await healthRes.json() : { gateway: 'unreachable' };

      setConfig(cfg);
      setHealth(h);

      // Build step list
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
        ...( cfg?.agents?.map((agentId) => ({
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
      setLoading(false);
    }
  };

  useEffect(() => { check(); }, []);

  const allOk = steps.length > 0 && steps.every((s) => s.status === 'ok');

  const StatusIcon = ({ status }: { status: StepStatus }) => {
    switch (status) {
      case 'ok':      return <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />;
      case 'error':   return <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />;
      case 'pending': return <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0" />;
      default:        return <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground flex-shrink-0" />;
    }
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Setup & Status</h1>
          <p className="text-muted-foreground mt-1">
            Check your ClawDeck configuration and gateway connection.
          </p>
        </div>

        {/* Overall status */}
        {!loading && (
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

        {/* Steps */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Configuration Checks</CardTitle>
              <Button variant="ghost" size="sm" onClick={check} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Re-check
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && steps.length === 0 ? (
              <div className="space-y-3">
                {[1,2,3].map(i => (
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
                  <div className="min-w-0">
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

        {/* Fix instructions */}
        {!loading && !allOk && (
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
                  After editing .env, restart: <code className="bg-muted px-1 rounded">docker compose up -d --build</code>
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Agent summary */}
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

        {/* Actions */}
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
