'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, PenLine, ChevronDown, ChevronUp, Clock } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  task: string;
  agentId: string;
}

interface Agent {
  id: string;
  name: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCHEDULE_PRESETS: Record<string, string> = {
  'Every hour': '0 * * * *',
  'Daily 9am': '0 9 * * *',
  'Daily midnight': '0 0 * * *',
  'Weekly Mon 9am': '0 9 * * 1',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function describeCron(schedule: string): string {
  const presetEntry = Object.entries(SCHEDULE_PRESETS).find(([, v]) => v === schedule);
  return presetEntry ? presetEntry[0] : schedule;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface AddJobFormProps {
  agents: Agent[];
  onCreated: (job: CronJob) => void;
  onCancel: () => void;
}

function AddJobForm({ agents, onCreated, onCancel }: AddJobFormProps) {
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [preset, setPreset] = useState('Daily 9am');
  const [task, setTask] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? 'main');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handlePresetChange = (p: string) => {
    setPreset(p);
    if (p && SCHEDULE_PRESETS[p]) {
      setSchedule(SCHEDULE_PRESETS[p]);
    }
  };

  const handleScheduleChange = (s: string) => {
    setSchedule(s);
    // Clear preset if user manually edits
    const match = Object.entries(SCHEDULE_PRESETS).find(([, v]) => v === s);
    setPreset(match ? match[0] : '');
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!schedule.trim()) { setError('Schedule is required'); return; }
    if (!task.trim()) { setError('Task description is required'); return; }
    if (!agentId.trim()) { setError('Agent is required'); return; }

    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/cron', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), schedule: schedule.trim(), task: task.trim(), agentId: agentId.trim(), enabled: true }),
      });
      const data = await res.json() as { job?: CronJob; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to create job');
        return;
      }
      onCreated(data.job!);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">New Cron Job</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Name */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily Summary"
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Schedule presets */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Schedule Preset</label>
          <select
            value={preset}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Custom...</option>
            {Object.keys(SCHEDULE_PRESETS).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Schedule input */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Cron Schedule <span className="text-[10px] font-mono">(5 fields)</span>
          </label>
          <input
            type="text"
            value={schedule}
            onChange={(e) => handleScheduleChange(e.target.value)}
            placeholder="0 9 * * *"
            className="w-full text-sm font-mono rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground mt-1">min hour day month weekday</p>
        </div>

        {/* Agent */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Agent</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {agents.length === 0 && <option value="main">main</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Task */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Task Description</label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Check emails and send a summary"
            rows={3}
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2">{error}</div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Add Job
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Edit Modal (inline) ────────────────────────────────────────────────────────

interface EditJobFormProps {
  job: CronJob;
  agents: Agent[];
  onSaved: (job: CronJob) => void;
  onCancel: () => void;
}

function EditJobForm({ job, agents, onSaved, onCancel }: EditJobFormProps) {
  const [name, setName] = useState(job.name);
  const [schedule, setSchedule] = useState(job.schedule);
  const [task, setTask] = useState(job.task);
  const [agentId, setAgentId] = useState(job.agentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSchedulePreset = (p: string) => {
    if (SCHEDULE_PRESETS[p]) setSchedule(SCHEDULE_PRESETS[p]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!schedule.trim()) { setError('Schedule is required'); return; }
    if (!task.trim()) { setError('Task is required'); return; }

    setSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/cron/${job.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), schedule: schedule.trim(), task: task.trim(), agentId: agentId.trim() }),
      });
      const data = await res.json() as { job?: CronJob; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to update job');
        return;
      }
      onSaved(data.job!);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 p-3 rounded-md border border-input bg-muted/30 space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Edit Job</p>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Preset shortcut */}
      <select
        value=""
        onChange={(e) => handleSchedulePreset(e.target.value)}
        className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Preset schedules...</option>
        {Object.keys(SCHEDULE_PRESETS).map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <input
        type="text"
        value={schedule}
        onChange={(e) => setSchedule(e.target.value)}
        placeholder="0 9 * * *"
        className="w-full text-sm font-mono rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
      />

      <select
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
        className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {agents.length === 0 && <option value="main">main</option>}
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>

      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Task description"
        rows={2}
        className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2">{error}</div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Save
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving} size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/cron', { credentials: 'include' });
      const data = await res.json() as { jobs?: CronJob[]; error?: string };
      if (res.ok) setJobs(data.jobs ?? []);
      else setError(data.error ?? 'Failed to load jobs');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetch('/api/agents', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: { agents?: Agent[] }) => setAgents(data.agents ?? []))
      .catch(() => { /* ignore */ });
  }, [fetchJobs]);

  const handleToggle = async (job: CronJob) => {
    setTogglingId(job.id);
    try {
      const res = await fetch(`/api/cron/${job.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      const data = await res.json() as { job?: CronJob; error?: string };
      if (res.ok && data.job) {
        setJobs((prev) => prev.map((j) => j.id === job.id ? data.job! : j));
      }
    } catch { /* ignore */ } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (job: CronJob) => {
    if (!window.confirm(`Delete cron job "${job.name}"?`)) return;
    setDeletingId(job.id);
    try {
      const res = await fetch(`/api/cron/${job.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
      }
    } catch { /* ignore */ } finally {
      setDeletingId(null);
    }
  };

  const handleCreated = (job: CronJob) => {
    setJobs((prev) => [...prev, job]);
    setShowAddForm(false);
  };

  const handleSaved = (updated: CronJob) => {
    setJobs((prev) => prev.map((j) => j.id === updated.id ? updated : j));
    setEditingId(null);
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">⏰ Cron Jobs</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage OpenClaw scheduled tasks</p>
          </div>
          <Button
            onClick={() => setShowAddForm((v) => !v)}
            variant={showAddForm ? 'outline' : 'default'}
          >
            {showAddForm ? (
              <><ChevronUp className="h-4 w-4 mr-2" />Cancel</>
            ) : (
              <><Plus className="h-4 w-4 mr-2" />Add Job</>
            )}
          </Button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <AddJobForm
            agents={agents}
            onCreated={handleCreated}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">{error}</div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading cron jobs...
          </div>
        )}

        {/* Jobs list */}
        {!loading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Clock className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No cron jobs yet</p>
            <p className="text-xs mt-1">Click &quot;Add Job&quot; to create a scheduled task</p>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <div className="space-y-3">
            {jobs.map((job) => (
              <Card key={job.id} className={job.enabled ? '' : 'opacity-60'}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{job.name}</span>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {job.schedule}
                        </Badge>
                        <Badge variant={job.enabled ? 'default' : 'outline'} className="text-xs">
                          {job.enabled ? 'enabled' : 'disabled'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {describeCron(job.schedule)} · Agent: <span className="font-mono">{job.agentId}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.task}</p>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Enable/Disable toggle */}
                      <button
                        onClick={() => handleToggle(job)}
                        disabled={togglingId === job.id}
                        title={job.enabled ? 'Disable' : 'Enable'}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{ backgroundColor: job.enabled ? 'hsl(var(--primary))' : 'hsl(var(--muted))' }}
                      >
                        <span
                          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
                          style={{ transform: job.enabled ? 'translateX(18px)' : 'translateX(2px)' }}
                        />
                        {togglingId === job.id && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="h-3 w-3 animate-spin text-primary-foreground" />
                          </span>
                        )}
                      </button>

                      {/* Edit */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditingId(editingId === job.id ? null : job.id)}
                        title="Edit"
                      >
                        {editingId === job.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <PenLine className="h-4 w-4" />
                        )}
                      </Button>

                      {/* Delete */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(job)}
                        disabled={deletingId === job.id}
                        title="Delete"
                      >
                        {deletingId === job.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Inline edit form */}
                  {editingId === job.id && (
                    <EditJobForm
                      job={job}
                      agents={agents}
                      onSaved={handleSaved}
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
