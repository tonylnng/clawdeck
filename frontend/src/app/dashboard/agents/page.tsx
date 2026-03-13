'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, MessageSquare, Bot, AlertCircle } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  status?: string;
  model?: string;
  channel?: string;
  lastActive?: string;
}

interface AgentsResponse {
  sessions?: Agent[];
  agents?: Agent[];
  [key: string]: unknown;
}

function statusColor(status?: string) {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'online':
      return 'bg-green-500';
    case 'idle':
      return 'bg-yellow-500';
    case 'offline':
    case 'stopped':
      return 'bg-gray-400';
    default:
      return 'bg-blue-500';
  }
}

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/agents', { credentials: 'include' });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AgentsResponse = await res.json();

      // Normalize different response shapes
      const list = data.sessions || data.agents || (Array.isArray(data) ? data : []);
      setAgents(list as Agent[]);
      setLastRefresh(new Date());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const openChat = (agentId: string) => {
    router.push(`/dashboard/chat?agent=${encodeURIComponent(agentId)}`);
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Agents</h1>
            {lastRefresh && (
              <p className="text-sm text-muted-foreground mt-1">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAgents}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

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
              <p className="text-sm mt-1">No active OpenClaw sessions detected</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <Card key={agent.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${statusColor(agent.status)}`}
                      />
                      <CardTitle className="text-base truncate">{agent.name || agent.id}</CardTitle>
                    </div>
                    {agent.status && (
                      <Badge variant="secondary" className="flex-shrink-0 text-xs capitalize">
                        {agent.status}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-1 text-sm text-muted-foreground mb-4">
                    <p className="truncate">
                      <span className="font-medium">ID:</span> {agent.id}
                    </p>
                    {agent.model && (
                      <p className="truncate">
                        <span className="font-medium">Model:</span> {agent.model}
                      </p>
                    )}
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
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => openChat(agent.id)}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Open Chat
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
