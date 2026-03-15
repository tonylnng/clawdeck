'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  RefreshCw, Plus, Trash2, Edit2, CheckCircle2, XCircle,
  Clock, Wifi, WifiOff, X, Save, TestTube2, Globe,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Instance {
  id: string;
  name: string;
  url: string;
  color: string;
  notes?: string;
  useProxy?: boolean;
  addedAt: string;
}

interface InstanceStatus {
  id: string;
  name: string;
  color: string;
  ok: boolean;
  latencyMs?: number;
  version?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRESET_COLORS = ['#6366f1','#22c55e','#f59e0b','#ec4899','#14b8a6','#ef4444','#8b5cf6','#f97316'];

function latencyBadge(ms?: number) {
  if (!ms) return null;
  const color = ms < 100 ? 'text-green-500' : ms < 500 ? 'text-yellow-500' : 'text-red-500';
  return <span className={`text-xs font-mono ${color}`}>{ms}ms</span>;
}

// ─── Add/Edit Form ────────────────────────────────────────────────────────────

function InstanceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Instance & { token: string }>;
  onSave: (data: { name: string; url: string; token: string; color: string; notes?: string; useProxy?: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [token, setToken] = useState(initial?.token ?? '');
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [useProxy, setUseProxy] = useState(initial?.useProxy ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);

  const handleTest = async () => {
    if (!url || !token) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/instances/ping', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, token }),
      });
      const data = await res.json() as { ok: boolean; latencyMs?: number; error?: string };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: 'Network error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name || !url || !token) return;
    setSaving(true);
    try {
      await onSave({ name, url, token, color, notes: notes || undefined, useProxy });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-card border rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{initial?.id ? 'Edit Instance' : 'Add Instance'}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input placeholder="e.g. Home Server" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs mt-1" />
          </div>

          <div>
            <Label className="text-xs">Gateway / Proxy URL</Label>
            <Input placeholder="http://100.x.x.x:18789" value={url} onChange={(e) => setUrl(e.target.value)} className="h-8 text-xs mt-1 font-mono" />
            <p className="text-[10px] text-muted-foreground mt-1">Tailscale IP recommended. Use port 18790 if Federation Proxy is installed.</p>
          </div>

          <div>
            <Label className="text-xs">Token</Label>
            <Input type="password" placeholder="Gateway or Federation Token" value={token} onChange={(e) => setToken(e.target.value)} className="h-8 text-xs mt-1 font-mono" />
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Input placeholder="e.g. Office server, Linux arm64" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-xs mt-1" />
          </div>

          <div>
            <Label className="text-xs">Color</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="useProxy" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} className="rounded" />
            <Label htmlFor="useProxy" className="text-xs cursor-pointer">Federation Proxy installed (port 18790)</Label>
          </div>
        </div>

        {/* Test Result */}
        {testResult && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs ${testResult.ok ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>
            {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {testResult.ok ? `Connected! Latency: ${testResult.latencyMs}ms` : `Failed: ${testResult.error}`}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleTest} disabled={!url || !token || testing}>
            <TestTube2 className={`h-3.5 w-3.5 ${testing ? 'animate-pulse' : ''}`} />Test Connection
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSave} disabled={!name || !url || !token || saving}>
            <Save className="h-3.5 w-3.5" />{saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Instance Card ────────────────────────────────────────────────────────────

function InstanceCard({
  instance,
  status,
  onEdit,
  onDelete,
  onPing,
}: {
  instance: Instance;
  status?: InstanceStatus;
  onEdit: () => void;
  onDelete: () => void;
  onPing: () => void;
}) {
  const isOnline = status?.ok;
  const isPinging = status === undefined;

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ background: instance.color }} />
      <CardContent className="p-4 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">{instance.name}</span>
              {status && (
                isOnline
                  ? <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><Wifi className="h-3 w-3" />Online</span>
                  : <span className="flex items-center gap-1 text-xs text-red-500"><WifiOff className="h-3 w-3" />Offline</span>
              )}
              {isPinging && <span className="text-xs text-muted-foreground">Checking...</span>}
            </div>
            <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{instance.url}</div>
            {instance.notes && <div className="text-xs text-muted-foreground mt-1">{instance.notes}</div>}
            {instance.useProxy && (
              <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 mt-1">
                <Globe className="h-2.5 w-2.5" />Federation Proxy
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {status?.latencyMs && latencyBadge(status.latencyMs)}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onPing} title="Refresh status">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onEdit} title="Edit">
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={onDelete} title="Remove">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {status?.error && (
          <div className="mt-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{status.error}</div>
        )}
        <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />Added {new Date(instance.addedAt).toLocaleDateString()}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InstancesPage() {
  const router = useRouter();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [statuses, setStatuses] = useState<Map<string, InstanceStatus>>(new Map());
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Instance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null);

  const fetchInstances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/instances', { credentials: 'include' });
      if (res.status === 401) { router.push('/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { instances: Instance[] };
      setInstances(data.instances ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  const pingAll = useCallback(async () => {
    try {
      const res = await fetch('/api/instances/all/status', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as { instances: InstanceStatus[] };
      const map = new Map<string, InstanceStatus>();
      data.instances.forEach((s) => map.set(s.id, s));
      setStatuses(map);
    } catch { /* silent */ }
  }, []);

  const pingOne = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/instances/${id}/status`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as InstanceStatus;
      setStatuses((prev) => new Map(prev).set(id, data));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  useEffect(() => {
    if (instances.length > 0) pingAll();
  }, [instances.length, pingAll]);

  const handleAdd = async (data: { name: string; url: string; token: string; color: string; notes?: string; useProxy?: boolean }) => {
    const res = await fetch('/api/instances', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) return;
    const result = await res.json() as { instance: Instance };
    setInstances((prev) => [...prev, result.instance]);
    setShowForm(false);
    pingOne(result.instance.id);
  };

  const handleEdit = async (data: { name: string; url: string; token: string; color: string; notes?: string; useProxy?: boolean }) => {
    if (!editTarget) return;
    const res = await fetch(`/api/instances/${editTarget.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) return;
    const result = await res.json() as { instance: Instance };
    setInstances((prev) => prev.map((i) => i.id === editTarget.id ? result.instance : i));
    setEditTarget(null);
    pingOne(result.instance.id);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/instances/${deleteTarget.id}`, { method: 'DELETE', credentials: 'include' });
    setInstances((prev) => prev.filter((i) => i.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const onlineCount = Array.from(statuses.values()).filter((s) => s.ok).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Forms & Dialogs */}
      {(showForm || editTarget) && (
        <InstanceForm
          initial={editTarget ?? undefined}
          onSave={editTarget ? handleEdit : handleAdd}
          onCancel={() => { setShowForm(false); setEditTarget(null); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-card border rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-sm">Remove Instance?</h3>
            <p className="text-xs text-muted-foreground">
              Remove <strong>{deleteTarget.name}</strong> from ClawDeck? The remote OpenClaw instance won&apos;t be affected.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>Remove</Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold flex items-center gap-2">
            🌐 Instance Manager
            {instances.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                {onlineCount}/{instances.length} online
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">Manage remote OpenClaw instances for Federation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={pingAll} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Check All
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)} className="h-8 gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />Add Instance
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="p-4 rounded-full bg-muted">
              <Globe className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-sm">No remote instances yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Add a remote OpenClaw instance to manage it from ClawDeck.
                Make sure Tailscale is installed on both machines.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />Add Your First Instance
            </Button>
            <a
              href="https://github.com/tonylnng/clawdeck#federation-install"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              Federation setup guide →
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {instances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instance={instance}
                status={statuses.get(instance.id)}
                onEdit={() => setEditTarget(instance)}
                onDelete={() => setDeleteTarget(instance)}
                onPing={() => pingOne(instance.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
