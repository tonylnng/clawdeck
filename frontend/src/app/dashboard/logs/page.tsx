'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw, Wifi, WifiOff, Trash2, Terminal, Bot, Copy, Check } from 'lucide-react';

interface LogLine {
  id: string;
  raw: string;
  level?: string;
  message?: string;
  timestamp?: string;
  [key: string]: unknown;
}

const AGENT_IDS = ['main', 'tonic-ai-tech', 'tonic-ai-workflow'];

let lineIdCounter = 0;
function nextLineId() {
  return `log-${Date.now()}-${lineIdCounter++}`;
}

function parseLogLine(raw: string): LogLine {
  const id = nextLineId();
  try {
    const obj = JSON.parse(raw);
    return {
      id,
      raw,
      level: obj.level || obj.severity || obj.lvl,
      message: obj.message || obj.msg || obj.text,
      timestamp: obj.timestamp || obj.time || obj.ts,
      ...obj,
    };
  } catch {
    const lowerRaw = raw.toLowerCase();
    let level: string | undefined;
    if (lowerRaw.includes('error')) level = 'error';
    else if (lowerRaw.includes('warn')) level = 'warn';
    else if (lowerRaw.includes('debug')) level = 'debug';
    else if (lowerRaw.includes('info')) level = 'info';

    return { id, raw, level };
  }
}

function levelColor(level?: string): string {
  switch (level?.toLowerCase()) {
    case 'error':
    case 'err':
    case 'fatal':
      return 'log-error';
    case 'warn':
    case 'warning':
      return 'log-warn';
    case 'info':
      return 'log-info';
    case 'debug':
    case 'trace':
      return 'log-debug';
    default:
      return 'text-foreground';
  }
}

function levelBadgeVariant(level?: string): 'destructive' | 'default' | 'secondary' | 'outline' {
  switch (level?.toLowerCase()) {
    case 'error':
    case 'fatal':
      return 'destructive';
    case 'warn':
      return 'default';
    case 'info':
      return 'secondary';
    default:
      return 'outline';
  }
}

// ─────────────────────────────────────────────
// Copyable log line row
// ─────────────────────────────────────────────
function LogLineRow({ line }: { line: LogLine }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(line.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={`group log-line flex gap-2 items-start hover:bg-muted/30 px-1 rounded ${levelColor(line.level)}`}
    >
      {line.timestamp && (
        <span className="text-muted-foreground flex-shrink-0 w-[135px]">
          {String(line.timestamp).slice(0, 19).replace('T', ' ')}
        </span>
      )}
      {line.level && (
        <Badge
          variant={levelBadgeVariant(line.level)}
          className="text-[10px] h-4 px-1 flex-shrink-0 uppercase leading-none"
        >
          {line.level.slice(0, 5)}
        </Badge>
      )}
      <span className="flex-1 break-all">
        {line.message || line.raw}
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0 p-0.5 rounded"
        title="Copy line"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Reusable log viewer panel
// ─────────────────────────────────────────────
interface LogViewerProps {
  fetchUrl: string;
  streamUrl: string;
}

function LogViewer({ fetchUrl, streamUrl }: LogViewerProps) {
  const router = useRouter();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;

  const scrollToBottom = useCallback(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(fetchUrl, { credentials: 'include' });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      const parsed: LogLine[] = (data.lines || []).map((line: unknown) => {
        if (typeof line === 'string') return parseLogLine(line);
        if (typeof line === 'object' && line !== null) {
          const obj = line as Record<string, unknown>;
          return parseLogLine(obj.raw as string || JSON.stringify(obj));
        }
        return parseLogLine(String(line));
      });
      setLines(parsed);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchUrl, router]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(streamUrl, { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'line') {
          const logLine = parseLogLine(parsed.data);
          setLines((prev) => {
            const updated = [...prev, logLine];
            return updated.length > 1000 ? updated.slice(-1000) : updated;
          });
        }
      } catch {
        // skip
      }
    };

    es.onerror = () => {
      setConnected(false);
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          connectSSE();
        }
      }, 5000);
    };
  }, [streamUrl]);

  // Reload and reconnect whenever URL changes (e.g. agent switch)
  useEffect(() => {
    setLines([]);
    loadInitial();
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [loadInitial, connectSSE]);

  const LEVEL_FILTERS = ['all', 'error', 'warn', 'info', 'debug'];

  const filteredLines = filter === 'all'
    ? lines
    : lines.filter((l) => {
        const level = (l.level || '').toLowerCase();
        if (filter === 'error') return ['error', 'fatal', 'err'].includes(level);
        if (filter === 'warn') return ['warn', 'warning'].includes(level);
        if (filter === 'info') return level === 'info';
        if (filter === 'debug') return ['debug', 'trace'].includes(level);
        return true;
      });

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card flex-shrink-0 flex-wrap">
        {/* Status */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <Wifi className="h-4 w-4 text-green-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {connected ? 'Live' : 'Disconnected'}
          </span>
        </div>

        <div className="flex-1" />

        {/* Level filter */}
        <div className="flex items-center gap-1">
          {LEVEL_FILTERS.map((lvl) => (
            <Button
              key={lvl}
              variant={filter === lvl ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs capitalize"
              onClick={() => setFilter(lvl)}
            >
              {lvl}
            </Button>
          ))}
        </div>

        {/* Auto-scroll */}
        <div className="flex items-center gap-2">
          <Switch
            id={`autoscroll-${streamUrl}`}
            checked={autoScroll}
            onCheckedChange={setAutoScroll}
          />
          <Label htmlFor={`autoscroll-${streamUrl}`} className="text-xs cursor-pointer">
            Auto-scroll
          </Label>
        </div>

        {/* Clear */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setLines([])}
          title="Clear"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={loadInitial}
          disabled={loading}
          title="Reload"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 px-3 py-1 border-b bg-muted/20 text-xs text-muted-foreground flex-shrink-0">
        <span>{filteredLines.length} lines</span>
        {filter !== 'all' && <span>filtered from {lines.length} total</span>}
      </div>

      {/* Log Output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto font-mono text-xs p-3 bg-background"
      >
        {filteredLines.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {loading ? 'Loading...' : 'No log lines'}
          </p>
        ) : (
          filteredLines.map((line) => (
            <LogLineRow key={line.id} line={line} />
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Agent Log tab: selector + viewer
// ─────────────────────────────────────────────
function AgentLogTab() {
  const [selectedAgent, setSelectedAgent] = useState<string>(AGENT_IDS[0]);

  return (
    <div className="h-full flex flex-col">
      {/* Agent selector */}
      <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/30 flex-shrink-0">
        <Bot className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">Agent:</span>
        <div className="flex items-center gap-1 flex-wrap">
          {AGENT_IDS.map((id) => (
            <Button
              key={id}
              variant={selectedAgent === id ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setSelectedAgent(id)}
            >
              {id}
            </Button>
          ))}
        </div>
      </div>

      {/* Log viewer — remounts with new URLs when agent changes */}
      <div className="flex-1 overflow-hidden">
        <LogViewer
          key={selectedAgent}
          fetchUrl={`/api/logs/agents/${encodeURIComponent(selectedAgent)}`}
          streamUrl={`/api/logs/stream?agentId=${encodeURIComponent(selectedAgent)}`}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default function LogsPage() {
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="gateway" className="flex flex-col h-full">
        {/* Tab bar */}
        <div className="flex items-center border-b bg-card px-3 flex-shrink-0">
          <TabsList className="h-10 bg-transparent gap-0 p-0">
            <TabsTrigger
              value="gateway"
              className="h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 text-xs gap-1.5"
            >
              <Terminal className="h-3.5 w-3.5" />
              Gateway Log
            </TabsTrigger>
            <TabsTrigger
              value="agent"
              className="h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 text-xs gap-1.5"
            >
              <Bot className="h-3.5 w-3.5" />
              Agent Log
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Gateway tab */}
        <TabsContent value="gateway" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <LogViewer
            fetchUrl="/api/logs/gateway"
            streamUrl="/api/logs/stream"
          />
        </TabsContent>

        {/* Agent tab */}
        <TabsContent value="agent" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <AgentLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
