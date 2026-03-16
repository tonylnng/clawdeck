'use client';

import { useState, useEffect } from 'react';

interface Instance {
  id: string;
  name: string;
  color: string;
  notes?: string;
  addedAt: string;
  useProxy?: boolean;
}

interface InstanceStatus {
  id: string;
  ok: boolean;
  latencyMs?: number;
}

interface InstanceFilterBarProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

export function InstanceFilterBar({ value, onChange, className = '' }: InstanceFilterBarProps) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [statuses, setStatuses] = useState<Map<string, InstanceStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/instances', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { instances: [] })
      .then((data: { instances?: Instance[] }) => {
        setInstances(data.instances ?? []);
      })
      .catch(() => setInstances([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (instances.length === 0) return;
    fetch('/api/instances/all/status', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { instances: [] })
      .then((data: { instances?: InstanceStatus[] }) => {
        const map = new Map<string, InstanceStatus>();
        (data.instances ?? []).forEach((s) => map.set(s.id, s));
        setStatuses(map);
      })
      .catch(() => { /* silent */ });
  }, [instances]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="h-8 w-20 bg-muted animate-pulse rounded-full" />
        <div className="h-8 w-20 bg-muted animate-pulse rounded-full" />
      </div>
    );
  }

  const chips: Array<{ id: string; label: string; color?: string; emoji?: string }> = [
    { id: 'local', label: 'Local', emoji: '🏠' },
    ...instances.map((i) => ({ id: i.id, label: i.name, color: i.color })),
    { id: 'all', label: 'All', emoji: '🌐' },
  ];

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {chips.map((chip) => {
        const isActive = value === chip.id;
        const status = chip.color ? statuses.get(chip.id) : undefined;
        const isOnline = status?.ok;
        const isOffline = status !== undefined && !status.ok;

        return (
          <button
            key={chip.id}
            onClick={() => onChange(chip.id)}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
              border transition-all
              ${isActive
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-background text-foreground border-border hover:bg-muted'
              }
            `}
            style={
              isActive && chip.color
                ? { backgroundColor: chip.color, borderColor: chip.color }
                : chip.color && !isActive
                ? { borderLeftColor: chip.color, borderLeftWidth: 3 }
                : undefined
            }
          >
            {chip.emoji && <span>{chip.emoji}</span>}
            {chip.color && !chip.emoji && (
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  isOnline ? '' : isOffline ? 'opacity-50' : ''
                }`}
                style={{ backgroundColor: chip.color }}
              />
            )}
            {chip.label}
            {/* online/offline dot */}
            {chip.color && (
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isOnline
                    ? 'bg-green-400'
                    : isOffline
                    ? 'bg-red-400'
                    : 'bg-gray-300'
                }`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
