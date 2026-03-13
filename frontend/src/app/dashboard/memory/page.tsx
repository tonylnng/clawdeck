'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Search, Trash2, Brain, Loader2, RefreshCw } from 'lucide-react';

const AGENTS = ['main', 'tonic-ai-tech', 'tonic-ai-workflow'];

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  fact: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  decision: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  entity: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  other: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

interface Memory {
  id: string;
  text: string;
  category?: string;
  importance?: number;
  created_at?: string;
  createdAt?: string;
  scope?: string;
}

function ImportanceBar({ value }: { value: number }) {
  const pct = Math.round((value || 0) * 100);
  const color =
    pct >= 80 ? 'bg-red-500' :
    pct >= 60 ? 'bg-orange-400' :
    pct >= 40 ? 'bg-yellow-400' :
    'bg-green-400';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function MemoryCard({
  memory,
  onDelete,
}: {
  memory: Memory;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const category = memory.category || 'other';
  const importance = memory.importance ?? 0.5;
  const dateStr = memory.created_at || memory.createdAt;
  const formattedDate = dateStr
    ? new Date(dateStr).toLocaleString('en-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'short', timeStyle: 'short' })
    : null;

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    onDelete(memory.id);
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed flex-1">{memory.text}</p>
        <Button
          variant={confirming ? 'destructive' : 'ghost'}
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={handleDelete}
          disabled={deleting}
          title={confirming ? 'Click again to confirm' : 'Delete memory'}
          onBlur={() => setConfirming(false)}
        >
          {deleting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[category] || CATEGORY_COLORS.other}`}>
            {category}
          </span>
          {memory.scope && (
            <span className="text-xs text-muted-foreground">scope: {memory.scope}</span>
          )}
          {formattedDate && (
            <span className="text-xs text-muted-foreground ml-auto">{formattedDate}</span>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Importance</span>
          </div>
          <ImportanceBar value={importance} />
        </div>
      </div>
    </div>
  );
}

export default function MemoryPage() {
  const [selectedAgent, setSelectedAgent] = useState('main');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const extractMemories = (data: unknown): Memory[] => {
    if (!data) return [];
    // Handle various response shapes from the gateway
    if (Array.isArray(data)) return data as Memory[];
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.memories)) return obj.memories as Memory[];
    if (Array.isArray(obj.results)) return obj.results as Memory[];
    if (obj.result && Array.isArray(obj.result)) return obj.result as Memory[];
    // Sometimes result is nested
    if (obj.result && typeof obj.result === 'object') {
      const inner = obj.result as Record<string, unknown>;
      if (Array.isArray(inner.memories)) return inner.memories as Memory[];
    }
    return [];
  };

  const loadMemories = useCallback(async (query?: string) => {
    if (query !== undefined && query.length > 0) {
      setSearching(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url =
        query
          ? `/api/memory/${selectedAgent}/search?q=${encodeURIComponent(query)}`
          : `/api/memory/${selectedAgent}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMemories(extractMemories(data));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [selectedAgent]);

  // Load on agent change
  useEffect(() => {
    setSearchQuery('');
    loadMemories();
  }, [selectedAgent, loadMemories]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchQuery === '') {
      loadMemories();
      return;
    }
    debounceRef.current = setTimeout(() => {
      loadMemories(searchQuery);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, loadMemories]);

  const handleDelete = async (memId: string) => {
    try {
      const res = await fetch(`/api/memory/${selectedAgent}/${memId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMemories((prev) => prev.filter((m) => m.id !== memId));
    } catch (err) {
      setError(`Delete failed: ${err}`);
    }
  };

  const isLoading = loading || searching;

  return (
    <div className="h-full flex flex-col">
      {/* Header Controls */}
      <div className="flex-shrink-0 p-4 border-b bg-card space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-semibold">Memory Browser</h1>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="text-sm bg-background border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {AGENTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadMemories(searchQuery || undefined)}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Memory List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading memories...</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 p-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Brain className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">
              {searchQuery ? 'No memories found for this query' : 'No memories found'}
            </p>
          </div>
        )}

        {!loading && memories.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground">
                {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
                {searchQuery && ` matching "${searchQuery}"`}
              </p>
            </div>
            <div className="space-y-3">
              {memories.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} onDelete={handleDelete} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
