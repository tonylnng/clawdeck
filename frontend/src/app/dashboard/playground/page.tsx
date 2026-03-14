'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, Trash2, Clock, Cpu, RotateCcw } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
}

interface HistoryEntry {
  id: string;
  prompt: string;
  response: string;
  model: string;
  tokens?: number;
  elapsedMs?: number;
  timestamp: number;
}

interface PlaygroundRunResponse {
  response: string;
  model: string;
  tokens?: number;
  elapsedMs?: number;
  error?: string;
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

const LS_HISTORY_KEY = 'clawdeck:playground:history';
const MAX_HISTORY = 5;

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(LS_HISTORY_KEY) ?? '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4 * 1.3);
}

function shortModelName(value: string): string {
  const found = MODEL_OPTIONS.find((m) => m.value === value);
  return found ? found.label : value.split('/').pop() ?? value;
}

// Basic HTML escape for safe rendering
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal markdown-to-HTML: bold, italic, code blocks, inline code, newlines
function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.slice(3, -3).replace(/^\n/, '');
    return `<pre class="bg-muted rounded p-3 overflow-x-auto text-xs my-2 whitespace-pre-wrap"><code>${code}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-muted rounded px-1 text-xs font-mono">$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="font-semibold text-sm mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="font-bold text-base mt-4 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="font-bold text-lg mt-4 mb-2">$1</h1>');

  // Unordered list items
  html = html.replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

  // Newlines to <br> (outside of block elements)
  html = html.replace(/\n/g, '<br/>');

  return html;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState<ModelValue>('default');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [responseModel, setResponseModel] = useState('');
  const [tokens, setTokens] = useState<number | undefined>();
  const [elapsedMs, setElapsedMs] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load agents
  useEffect(() => {
    fetch('/api/agents', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: { agents?: Agent[] }) => {
        setAgents(data.agents ?? []);
        if (data.agents && data.agents.length > 0) {
          setAgentId(data.agents[0].id);
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  // Load history from localStorage
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const tokenEstimate = estimateTokens(
    (systemPrompt ? systemPrompt + '\n' : '') + prompt
  );

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError('');
    setResponse('');
    setResponseModel('');
    setTokens(undefined);
    setElapsedMs(undefined);

    try {
      const res = await fetch('/api/playground/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agentId || undefined,
          prompt: prompt.trim(),
          model: model !== 'default' ? model : undefined,
          systemPrompt: systemPrompt.trim() || undefined,
        }),
      });

      const data = await res.json() as PlaygroundRunResponse;

      if (!res.ok) {
        setError(data.error ?? 'Unknown error');
        return;
      }

      setResponse(data.response);
      setResponseModel(data.model);
      setTokens(data.tokens);
      setElapsedMs(data.elapsedMs);

      // Save to history
      const entry: HistoryEntry = {
        id: Date.now().toString(36),
        prompt: prompt.trim(),
        response: data.response,
        model: data.model,
        tokens: data.tokens,
        elapsedMs: data.elapsedMs,
        timestamp: Date.now(),
      };
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);

    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, model, prompt, systemPrompt, loading, history]);

  // Ctrl+Enter to submit
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleClear = () => {
    setPrompt('');
    setResponse('');
    setResponseModel('');
    setTokens(undefined);
    setElapsedMs(undefined);
    setError('');
    textareaRef.current?.focus();
  };

  const handleReuseHistory = (entry: HistoryEntry) => {
    setPrompt(entry.prompt);
    setResponse('');
    setResponseModel('');
    setTokens(undefined);
    setElapsedMs(undefined);
    setError('');
    textareaRef.current?.focus();
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">🧪 Prompt Playground</h1>
          <p className="text-muted-foreground text-sm mt-1">Test prompts with any agent and model</p>
        </div>

        {/* Main layout: two columns on desktop */}
        <div className="flex flex-col md:flex-row gap-4">

          {/* ── Left Column: Config ─────────────────────────────────────── */}
          <div className="w-full md:w-72 flex-shrink-0 space-y-4">

            {/* Agent Selector */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">

                {/* Agent */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Agent</label>
                  <select
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">(no session)</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                {/* Model */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value as ModelValue)}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* System Prompt */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">System Prompt (optional)</label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="You are a helpful assistant..."
                    rows={4}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {/* Token estimate */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" />
                  <span>~{tokenEstimate.toLocaleString()} estimated tokens</span>
                </div>
              </CardContent>
            </Card>

            {/* History */}
            {history.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Recent History
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {history.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => handleReuseHistory(entry)}
                      className="w-full text-left p-2 rounded-md border border-input hover:bg-accent transition-colors group"
                    >
                      <p className="text-xs font-medium line-clamp-2 group-hover:text-foreground text-muted-foreground">
                        {entry.prompt}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {shortModelName(entry.model)} · {entry.tokens ? `${entry.tokens} tokens` : ''}
                      </p>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right Column: Chat ──────────────────────────────────────── */}
          <div className="flex-1 space-y-4">

            {/* Prompt Input */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Prompt <span className="text-[10px]">(Ctrl+Enter to send)</span>
                  </label>
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter your prompt here..."
                    rows={5}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={loading}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleSubmit}
                    disabled={!prompt.trim() || loading}
                    className="flex-1"
                  >
                    {loading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-2" />Run</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleClear}
                    disabled={loading}
                    title="Clear"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Response */}
            {(response || error || loading) && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">Response</CardTitle>
                    <div className="flex items-center gap-2">
                      {responseModel && (
                        <Badge variant="secondary" className="text-xs">
                          {shortModelName(responseModel)}
                        </Badge>
                      )}
                      {tokens !== undefined && (
                        <Badge variant="outline" className="text-xs">
                          <Cpu className="h-3 w-3 mr-1" />
                          {tokens} tokens
                        </Badge>
                      )}
                      {elapsedMs !== undefined && (
                        <Badge variant="outline" className="text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          {(elapsedMs / 1000).toFixed(1)}s
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {loading && (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking...
                    </div>
                  )}
                  {error && !loading && (
                    <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                      {error}
                    </div>
                  )}
                  {response && !loading && (
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(response) }}
                    />
                  )}
                </CardContent>
              </Card>
            )}

            {/* Empty state */}
            {!response && !error && !loading && (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <RotateCcw className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">Run a prompt to see the response here</p>
                <p className="text-xs mt-1">Use Ctrl+Enter for quick submission</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
