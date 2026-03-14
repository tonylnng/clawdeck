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

// ── Visual Cron Builder ────────────────────────────────────────────────────────

const MINUTE_OPTIONS = [
  { label: 'Every minute', value: '*' },
  { label: 'Every 5 min', value: '*/5' },
  { label: 'Every 10 min', value: '*/10' },
  { label: 'Every 15 min', value: '*/15' },
  { label: 'Every 30 min', value: '*/30' },
  { label: 'At :00', value: '0' },
  { label: 'At :15', value: '15' },
  { label: 'At :30', value: '30' },
  { label: 'At :45', value: '45' },
];

const HOUR_OPTIONS = [
  { label: 'Every hour', value: '*' },
  { label: 'Every 2h', value: '*/2' },
  { label: 'Every 4h', value: '*/4' },
  { label: 'Every 6h', value: '*/6' },
  { label: 'Every 12h', value: '*/12' },
  ...Array.from({ length: 24 }, (_, i) => ({ label: `${i}:00`, value: String(i) })),
];

const DAY_OPTIONS = [
  { label: 'Every day', value: '*' },
  { label: '1st', value: '1' },
  { label: '15th', value: '15' },
  { label: 'Last (28th)', value: '28' },
];

const MONTH_OPTIONS = [
  { label: 'Every month', value: '*' },
  { label: 'Jan', value: '1' },
  { label: 'Feb', value: '2' },
  { label: 'Mar', value: '3' },
  { label: 'Apr', value: '4' },
  { label: 'May', value: '5' },
  { label: 'Jun', value: '6' },
  { label: 'Jul', value: '7' },
  { label: 'Aug', value: '8' },
  { label: 'Sep', value: '9' },
  { label: 'Oct', value: '10' },
  { label: 'Nov', value: '11' },
  { label: 'Dec', value: '12' },
];

const WEEKDAY_OPTIONS = [
  { label: 'Any day', value: '*' },
  { label: 'Mon', value: '1' },
  { label: 'Tue', value: '2' },
  { label: 'Wed', value: '3' },
  { label: 'Thu', value: '4' },
  { label: 'Fri', value: '5' },
  { label: 'Sat', value: '6' },
  { label: 'Sun', value: '0' },
  { label: 'Weekdays', value: '1-5' },
  { label: 'Weekend', value: '0,6' },
];

const QUICK_PRESETS = [
  { label: '⏰ Every hour', value: '0 * * * *' },
  { label: '🌅 Daily 9am', value: '0 9 * * *' },
  { label: '🌙 Daily midnight', value: '0 0 * * *' },
  { label: '📅 Mon 9am', value: '0 9 * * 1' },
  { label: '📅 Weekdays 9am', value: '0 9 * * 1-5' },
  { label: '🔔 Every 30 min', value: '*/30 * * * *' },
];

function parseCron(schedule: string): { min: string; hour: string; day: string; month: string; weekday: string } {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return { min: '0', hour: '9', day: '*', month: '*', weekday: '*' };
  return { min: parts[0], hour: parts[1], day: parts[2], month: parts[3], weekday: parts[4] };
}

function buildCron(min: string, hour: string, day: string, month: string, weekday: string): string {
  return `${min} ${hour} ${day} ${month} ${weekday}`;
}

function humanizeCron(schedule: string): string {
  const preset = QUICK_PRESETS.find((p) => p.value === schedule);
  if (preset) return preset.label.replace(/^[^\s]+ /, '');
  const { min, hour, day, month, weekday } = parseCron(schedule);
  const parts: string[] = [];
  if (min === '*') parts.push('every minute');
  else if (min.startsWith('*/')) parts.push(`every ${min.slice(2)} min`);
  else parts.push(`at :${min.padStart(2, '0')}`);
  if (hour === '*') { /* every hour */ }
  else if (hour.startsWith('*/')) parts.push(`every ${hour.slice(2)}h`);
  else parts.push(`${hour}:00`);
  if (weekday !== '*') parts.push(`on ${weekday}`);
  if (day !== '*') parts.push(`on day ${day}`);
  if (month !== '*') parts.push(`in month ${month}`);
  return parts.join(', ') || schedule;
}

interface CronBuilderProps {
  value: string;
  onChange: (schedule: string) => void;
}

function CronBuilder({ value, onChange }: CronBuilderProps) {
  const parsed = parseCron(value);
  const [min, setMin] = useState(parsed.min);
  const [hour, setHour] = useState(parsed.hour);
  const [day, setDay] = useState(parsed.day);
  const [month, setMonth] = useState(parsed.month);
  const [weekday, setWeekday] = useState(parsed.weekday);
  const [customMode, setCustomMode] = useState(false);

  const update = (field: string, val: string) => {
    const next = {
      min: field === 'min' ? val : min,
      hour: field === 'hour' ? val : hour,
      day: field === 'day' ? val : day,
      month: field === 'month' ? val : month,
      weekday: field === 'weekday' ? val : weekday,
    };
    setMin(next.min); setHour(next.hour); setDay(next.day); setMonth(next.month); setWeekday(next.weekday);
    onChange(buildCron(next.min, next.hour, next.day, next.month, next.weekday));
  };

  const applyPreset = (preset: string) => {
    const p = parseCron(preset);
    setMin(p.min); setHour(p.hour); setDay(p.day); setMonth(p.month); setWeekday(p.weekday);
    onChange(preset);
    setCustomMode(false);
  };

  const selectClass = "text-xs rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="space-y-3">
      {/* Quick presets */}
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Quick presets</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => applyPreset(p.value)}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                value === p.value && !customMode
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-input hover:bg-accent'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustomMode((v) => !v)}
            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
              customMode ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-accent'
            }`}
          >
            ✏️ Custom
          </button>
        </div>
      </div>

      {/* Visual picker */}
      {!customMode && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Minute</p>
            <select value={min} onChange={(e) => update('min', e.target.value)} className={selectClass}>
              {MINUTE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Hour</p>
            <select value={hour} onChange={(e) => update('hour', e.target.value)} className={selectClass}>
              {HOUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Day</p>
            <select value={day} onChange={(e) => update('day', e.target.value)} className={selectClass}>
              {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Month</p>
            <select value={month} onChange={(e) => update('month', e.target.value)} className={selectClass}>
              {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Weekday</p>
            <select value={weekday} onChange={(e) => update('weekday', e.target.value)} className={selectClass}>
              {WEEKDAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Custom cron input */}
      {customMode && (
        <div>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 9 * * *"
            className="w-full text-sm font-mono rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground mt-1">Format: min hour day month weekday</p>
        </div>
      )}

      {/* Preview */}
      <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground">Preview: </span>
        <span className="text-xs font-medium">{humanizeCron(value)}</span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}

// ── Add Job Form ──────────────────────────────────────────────────────────────

interface AddJobFormProps {
  agents: Agent[];
  onCreated: (job: CronJob) => void;
  onCancel: () => void;
}

function AddJobForm({ agents, onCreated, onCancel }: AddJobFormProps) {
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [task, setTask] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? 'main');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!schedule.trim()) { setError('Schedule is required'); return; }
    if (!task.trim()) { setError('Task description is required'); return; }

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
      if (!res.ok) { setError(data.error ?? 'Failed to create job'); return; }
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
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily Summary"
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-2">Schedule</label>
          <CronBuilder value={schedule} onChange={setSchedule} />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Agent</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring">
            {agents.length === 0 && <option value="main">main</option>}
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Task Description</label>
          <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="Check emails and send a summary"
            rows={3} className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>

        {error && <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2">{error}</div>}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Add Job
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Edit Job Form ─────────────────────────────────────────────────────────────

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

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
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
      if (!res.ok) { setError(data.error ?? 'Failed to update'); return; }
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
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
        className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring" />
      <CronBuilder value={schedule} onChange={setSchedule} />
      <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
        className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring">
        {agents.length === 0 && <option value="main">main</option>}
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="Task description" rows={2}
        className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
      {error && <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}Save
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving} size="sm">Cancel</Button>
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
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      const data = await res.json() as { job?: CronJob };
      if (res.ok && data.job) setJobs((prev) => prev.map((j) => j.id === job.id ? data.job! : j));
    } catch { /* ignore */ } finally { setTogglingId(null); }
  };

  const handleDelete = async (job: CronJob) => {
    if (!window.confirm(`Delete "${job.name}"?`)) return;
    setDeletingId(job.id);
    try {
      const res = await fetch(`/api/cron/${job.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch { /* ignore */ } finally { setDeletingId(null); }
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">⏰ Cron Jobs</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage OpenClaw scheduled tasks</p>
          </div>
          <Button onClick={() => setShowAddForm((v) => !v)} variant={showAddForm ? 'outline' : 'default'}>
            {showAddForm ? <><ChevronUp className="h-4 w-4 mr-2" />Cancel</> : <><Plus className="h-4 w-4 mr-2" />Add Job</>}
          </Button>
        </div>

        {showAddForm && <AddJobForm agents={agents} onCreated={(job) => { setJobs((p) => [...p, job]); setShowAddForm(false); }} onCancel={() => setShowAddForm(false)} />}

        {error && <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">{error}</div>}

        {loading && <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div>}

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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{job.name}</span>
                        <Badge variant="secondary" className="font-mono text-xs">{job.schedule}</Badge>
                        <Badge variant={job.enabled ? 'default' : 'outline'} className="text-xs">{job.enabled ? 'enabled' : 'disabled'}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {humanizeCron(job.schedule)} · Agent: <span className="font-mono">{job.agentId}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.task}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggle(job)}
                        disabled={togglingId === job.id}
                        title={job.enabled ? 'Disable' : 'Enable'}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        style={{ backgroundColor: job.enabled ? 'hsl(var(--primary))' : 'hsl(var(--muted))' }}
                      >
                        <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
                          style={{ transform: job.enabled ? 'translateX(18px)' : 'translateX(2px)' }} />
                        {togglingId === job.id && <span className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-3 w-3 animate-spin text-primary-foreground" /></span>}
                      </button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(editingId === job.id ? null : job.id)} title="Edit">
                        {editingId === job.id ? <ChevronUp className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(job)} disabled={deletingId === job.id} title="Delete">
                        {deletingId === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  {editingId === job.id && (
                    <EditJobForm job={job} agents={agents} onSaved={(updated) => { setJobs((p) => p.map((j) => j.id === updated.id ? updated : j)); setEditingId(null); }} onCancel={() => setEditingId(null)} />
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
