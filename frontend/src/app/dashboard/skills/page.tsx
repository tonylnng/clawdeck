'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Trash2, Download, RotateCcw, BookOpen, X, Search, Package } from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  description: string;
  version?: string;
  publishedAt?: number;
  hasSkillMd: boolean;
  files: string[];
  installed: boolean;
  fromClawHub: boolean;
}

function timeAgo(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Skill Card ────────────────────────────────────────────────────────────────

function SkillCard({ skill, onRemove, onUpdate, onViewReadme }: {
  skill: Skill;
  onRemove: (id: string) => void;
  onUpdate: (id: string) => void;
  onViewReadme: (id: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [updating, setUpdating] = useState(false);

  const handleRemove = async () => {
    if (!window.confirm(`Remove skill "${skill.name}"? This cannot be undone.`)) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) onRemove(skill.id);
    } catch { /* ignore */ } finally { setRemoving(false); }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    onUpdate(skill.id);
    // Reset after 3s (streaming happens in parent)
    setTimeout(() => setUpdating(false), 3000);
  };

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm">{skill.name}</span>
              {skill.version && <Badge variant="outline" className="text-[10px] font-mono">{skill.version}</Badge>}
              {skill.fromClawHub && <Badge className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-500/20">ClawHub</Badge>}
              {skill.publishedAt && <span className="text-[10px] text-muted-foreground">{timeAgo(skill.publishedAt)}</span>}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{skill.description || <em>No description</em>}</p>
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {skill.files.slice(0, 5).map((f) => (
                <span key={f} className="text-[10px] font-mono px-1.5 py-0.5 bg-muted rounded">{f}</span>
              ))}
              {skill.files.length > 5 && <span className="text-[10px] text-muted-foreground">+{skill.files.length - 5} more</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {skill.hasSkillMd && (
              <Button variant="ghost" size="icon" className="h-8 w-8" title="View SKILL.md" onClick={() => onViewReadme(skill.id)}>
                <BookOpen className="h-4 w-4" />
              </Button>
            )}
            {skill.fromClawHub && (
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Update from ClawHub" onClick={handleUpdate} disabled={updating}>
                <RotateCcw className={`h-4 w-4 ${updating ? 'animate-spin' : ''}`} />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Remove skill" onClick={handleRemove} disabled={removing}>
              {removing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── README Modal ──────────────────────────────────────────────────────────────

function ReadmeModal({ skillId, onClose }: { skillId: string; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/skills/${encodeURIComponent(skillId)}/readme`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { content?: string }) => setContent(d.content ?? 'No content'))
      .catch(() => setContent('Failed to load SKILL.md'))
      .finally(() => setLoading(false));
  }, [skillId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">SKILL.md — {skillId}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Install Panel ─────────────────────────────────────────────────────────────

function InstallPanel({ onInstalled }: { onInstalled: () => void }) {
  const [slug, setSlug] = useState('');
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState('');
  const logRef = useRef<HTMLPreElement>(null);

  const handleInstall = async () => {
    const s = slug.trim();
    if (!s) return;
    setInstalling(true);
    setLog('');

    try {
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: s }),
      });

      if (!res.body) { setLog('No response body'); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          setLog((prev) => prev + chunk);
          // Auto-scroll
          setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
        }
      }

      onInstalled();
    } catch (err) {
      setLog(String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Install from ClawHub</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !installing && handleInstall()}
            placeholder="skill-slug (e.g. weather)"
            className="flex-1 text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button onClick={handleInstall} disabled={installing || !slug.trim()} size="sm">
            {installing ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            Install
          </Button>
        </div>
        {log && (
          <pre ref={logRef} className="text-[11px] font-mono bg-muted/60 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">
            {log}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [readmeSkill, setReadmeSkill] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/skills', { credentials: 'include' });
      if (res.status === 401) { router.push('/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { skills: Skill[] };
      setSkills(data.skills ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleUpdate = async (id: string) => {
    setUpdateLog('');
    try {
      const res = await fetch('/api/skills/update', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: id }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) setUpdateLog((prev) => (prev ?? '') + decoder.decode(value, { stream: true }));
      }
      fetchSkills();
    } catch (err) {
      setUpdateLog(String(err));
    }
  };

  const filtered = skills.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.id.toLowerCase().includes(search.toLowerCase())
  );

  const clawHubCount = skills.filter((s) => s.fromClawHub).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold">🧩 Skill Manager</h1>
          <p className="text-xs text-muted-foreground">{skills.length} installed · {clawHubCount} from ClawHub</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchSkills} disabled={loading} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowInstall((v) => !v)} className="h-8 gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" />
            Install
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">{error}</div>}

        {showInstall && <InstallPanel onInstalled={() => { setShowInstall(false); fetchSkills(); }} />}

        {updateLog !== null && (
          <div className="rounded-md bg-muted/60 border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium">Update output</p>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setUpdateLog(null)}><X className="h-3 w-3" /></Button>
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap max-h-32 overflow-auto">{updateLog}</pre>
          </div>
        )}

        {/* Search */}
        {skills.length > 4 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills..."
              className="w-full text-sm pl-9 pr-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {/* Skills grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />Loading skills...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
            <Package className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">{search ? 'No skills match your search' : 'No skills installed'}</p>
            {!search && <p className="text-xs mt-1">Click &quot;Install&quot; to add skills from ClawHub</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onRemove={(id) => setSkills((prev) => prev.filter((s) => s.id !== id))}
                onUpdate={handleUpdate}
                onViewReadme={setReadmeSkill}
              />
            ))}
          </div>
        )}
      </div>

      {readmeSkill && <ReadmeModal skillId={readmeSkill} onClose={() => setReadmeSkill(null)} />}
    </div>
  );
}
