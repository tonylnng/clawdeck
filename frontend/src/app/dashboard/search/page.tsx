'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Download, Loader2, MessageSquare, AlertCircle } from 'lucide-react';

interface SearchResult {
  sessionKey: string;
  agentId: string;
  role: 'user' | 'assistant';
  content: string;
  matchedAt: string;
  preview: string;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
}

const AGENT_OPTIONS = [
  { value: 'all', label: 'All Agents' },
  { value: 'main', label: 'main' },
  { value: 'tonic-ai-tech', label: 'tonic-ai-tech' },
  { value: 'tonic-ai-workflow', label: 'tonic-ai-workflow' },
];

function truncateSessionKey(key: string, maxLen = 40): string {
  if (key.length <= maxLen) return key;
  return `…${key.slice(-maxLen)}`;
}

function highlightQuery(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).replace(',', '');
  } catch {
    return isoString;
  }
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const params = new URLSearchParams({ q, limit: '20' });
      if (agentFilter !== 'all') {
        params.set('agent', agentFilter);
      }

      const res = await fetch(`/api/search?${params.toString()}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Search failed' }));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }

      const data: SearchResponse = await res.json();
      setResults(data.results);
      setTotalCount(data.total);
      setSearchedQuery(data.query);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [query, agentFilter]);

  const handleExport = (sessionKey: string) => {
    const encoded = encodeURIComponent(sessionKey);
    const url = `/api/search/export/${encoded}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${sessionKey.replace(/[^a-zA-Z0-9_\-:.]/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-card px-4 py-3 flex-shrink-0">
        <h1 className="text-base font-semibold flex items-center gap-2">
          <Search className="h-4 w-4" />
          Conversation Search
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Search across all agent conversation histories
        </p>
      </div>

      {/* Search Controls */}
      <div className="border-b bg-muted/30 px-4 py-3 flex-shrink-0">
        <div className="flex flex-col sm:flex-row gap-2 max-w-3xl">
          <Input
            className="flex-1"
            placeholder="Search conversations..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            disabled={loading}
          />
          <select
            className="h-10 w-full sm:w-44 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            disabled={loading}
          >
            {AGENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button onClick={handleSearch} disabled={loading || !query.trim()} className="shrink-0">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Search
          </Button>
        </div>
        {loading && (
          <p className="text-xs text-muted-foreground mt-2">
            Searching sessions… this may take a moment.
          </p>
        )}
      </div>

      {/* Results */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Error state */}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Results summary */}
          {results !== null && !error && (
            <p className="text-xs text-muted-foreground">
              {totalCount === 0
                ? `No results for "${searchedQuery}"`
                : `${totalCount} result${totalCount !== 1 ? 's' : ''} for "${searchedQuery}"`}
            </p>
          )}

          {/* Empty state */}
          {results !== null && results.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <MessageSquare className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">No conversations matched your search</p>
              <p className="text-xs mt-1 opacity-60">Try a different query or agent filter</p>
            </div>
          )}

          {/* Initial empty state (no search yet) */}
          {results === null && !loading && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Search className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">Enter a search term to find conversations</p>
              <p className="text-xs mt-1 opacity-60">Searches up to 10 recent sessions</p>
            </div>
          )}

          {/* Result cards */}
          {results?.map((result, idx) => (
            <div
              key={`${result.sessionKey}-${result.role}-${idx}`}
              className="rounded-lg border bg-card p-4 space-y-2 hover:shadow-sm transition-shadow"
            >
              {/* Top row: badges + export button */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <Badge
                    variant={result.role === 'user' ? 'default' : 'secondary'}
                    className="text-xs shrink-0"
                  >
                    {result.agentId}
                  </Badge>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {result.role}
                  </Badge>
                  <span
                    className="text-xs text-muted-foreground font-mono truncate"
                    title={result.sessionKey}
                  >
                    {truncateSessionKey(result.sessionKey)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 shrink-0 text-xs"
                  onClick={() => handleExport(result.sessionKey)}
                  title="Export session as Markdown"
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Export
                </Button>
              </div>

              {/* Preview text with highlighted query */}
              <p className="text-sm text-foreground leading-relaxed line-clamp-3">
                {highlightQuery(result.preview, searchedQuery)}
              </p>

              {/* Timestamp */}
              <p className="text-xs text-muted-foreground">
                {formatDate(result.matchedAt)}
              </p>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
