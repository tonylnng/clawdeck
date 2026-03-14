'use client';

import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatMessage } from '@/components/chat/ChatMessage';
import {
  Plus, X, Send, Loader2, Bot, Paperclip, FileText,
  Image as ImageIcon, Trash2, LayoutTemplate, Rows3,
  Pin, ChevronDown, ChevronUp, Radio, ChevronDown as ChevronDownIcon,
  Users, RefreshCw,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  pinned?: boolean;
  source?: string; // channel source badge e.g. "telegram"
  agentId?: string; // group chat: which agent sent this
  color?: string;   // group chat: agent color
  attachment?: {
    type: 'image' | 'file';
    name: string;
    preview?: string;
  };
}

interface ChatTab {
  id: string;
  agentId: string;
  label: string;
  messages: Message[];
  streaming: boolean;
  input: string;
  pendingFile: File | null;
  pendingFilePreview: string | null;
  // Mode
  mode: 'agent' | 'channel' | 'group';
  // Channel mode fields
  sessionKey?: string;
  lastPollTimestamp?: string;
  // Group mode fields
  groupAgents?: string[];
  groupStarted?: boolean;
  autoRound?: boolean;
}

// ─── LocalStorage Schema ───────────────────────────────────────────────────────
interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  pinned?: boolean;
  source?: string;
  agentId?: string;
  color?: string;
  attachment?: { type: 'image' | 'file'; name: string; preview?: string };
}

interface PersistedTab {
  id: string;
  agentId: string;
  label: string;
  messages: PersistedMessage[];
  mode?: 'agent' | 'channel' | 'group';
  sessionKey?: string;
  groupAgents?: string[];
  autoRound?: boolean;
}

const LS_KEY = 'clawdeck-chat-tabs';
const LS_ACTIVE_KEY = 'clawdeck-chat-active';
const MAX_TABS = 20;
const MAX_MESSAGES_PER_TAB = 100;
const MAX_SPLIT_PANELS = 8;
const POLL_INTERVAL_MS = 5000;

// ─── Group Chat Colors ────────────────────────────────────────────────────────

const GROUP_COLORS = ['purple', 'green', 'orange', 'pink', 'cyan', 'yellow'] as const;
type GroupColor = typeof GROUP_COLORS[number];

const GROUP_COLOR_STYLES: Record<GroupColor, {
  avatar: string;
  label: string;
  bubble: string;
}> = {
  purple: {
    avatar: 'bg-purple-500 text-white',
    label: 'text-purple-600 dark:text-purple-400',
    bubble: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800',
  },
  green: {
    avatar: 'bg-green-500 text-white',
    label: 'text-green-600 dark:text-green-400',
    bubble: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800',
  },
  orange: {
    avatar: 'bg-orange-500 text-white',
    label: 'text-orange-600 dark:text-orange-400',
    bubble: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800',
  },
  pink: {
    avatar: 'bg-pink-500 text-white',
    label: 'text-pink-600 dark:text-pink-400',
    bubble: 'bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800',
  },
  cyan: {
    avatar: 'bg-cyan-500 text-white',
    label: 'text-cyan-600 dark:text-cyan-400',
    bubble: 'bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800',
  },
  yellow: {
    avatar: 'bg-yellow-500 text-white',
    label: 'text-yellow-700 dark:text-yellow-400',
    bubble: 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800',
  },
};

function getAgentColor(index: number): GroupColor {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

// ─── Quick Commands ───────────────────────────────────────────────────────────

interface QuickCommand {
  name: string;
  description: string;
  args?: string;
}

const QUICK_COMMANDS: QuickCommand[] = [
  { name: '/clear', description: 'Clear conversation' },
  { name: '/agent', description: 'Switch agent ID', args: '<id>' },
  { name: '/new', description: 'Open new chat tab' },
  { name: '/help', description: 'Show all commands' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tabCounter = 0;

function createTab(agentId: string = ''): ChatTab {
  tabCounter++;
  return {
    id: `tab-${tabCounter}-${Date.now()}`,
    agentId,
    label: agentId ? agentId.slice(0, 20) : `Chat ${tabCounter}`,
    messages: [],
    streaming: false,
    input: '',
    pendingFile: null,
    pendingFilePreview: null,
    mode: 'agent',
    groupAgents: [],
    groupStarted: false,
    autoRound: false,
  };
}

function isImageFile(file: File): boolean {
  return (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    /\.(jpg|jpeg|png)$/i.test(file.name)
  );
}

function autoLabel(text: string): string {
  const trimmed = text.trim().slice(0, 20);
  return trimmed.length < text.trim().length ? trimmed + '…' : trimmed;
}

function splitGridClass(count: number): string {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-3';
  return 'grid-cols-4';
}

function channelBadgeColor(source?: string): string {
  const map: Record<string, string> = {
    telegram: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    whatsapp: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    discord: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    slack: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  };
  return map[source?.toLowerCase() || ''] || 'bg-muted text-muted-foreground border-border';
}

// ─── Persistence helpers ───────────────────────────────────────────────────────

function saveTabs(tabs: ChatTab[], activeTabId: string) {
  try {
    const persisted: PersistedTab[] = tabs.slice(0, MAX_TABS).map((tab) => ({
      id: tab.id,
      agentId: tab.agentId,
      label: tab.label,
      mode: tab.mode,
      sessionKey: tab.sessionKey,
      groupAgents: tab.groupAgents,
      autoRound: tab.autoRound,
      messages: tab.messages.slice(-MAX_MESSAGES_PER_TAB).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
        pinned: m.pinned,
        source: m.source,
        agentId: m.agentId,
        color: m.color,
        attachment: m.attachment,
      })),
    }));
    localStorage.setItem(LS_KEY, JSON.stringify(persisted));
    localStorage.setItem(LS_ACTIVE_KEY, activeTabId);
  } catch {
    // Quota exceeded or SSR — ignore
  }
}

function loadTabs(): { tabs: ChatTab[]; activeTabId: string } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const savedActive = localStorage.getItem(LS_ACTIVE_KEY) || '';
    if (!raw) return null;

    const persisted: PersistedTab[] = JSON.parse(raw);
    if (!Array.isArray(persisted) || persisted.length === 0) return null;

    const tabs: ChatTab[] = persisted.map((pt) => ({
      id: pt.id,
      agentId: pt.agentId ?? '',
      label: pt.label ?? 'Chat',
      streaming: false,
      input: '',
      pendingFile: null,
      pendingFilePreview: null,
      mode: pt.mode ?? 'agent',
      sessionKey: pt.sessionKey,
      groupAgents: pt.groupAgents ?? [],
      groupStarted: false,
      autoRound: pt.autoRound ?? false,
      messages: (pt.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp),
        pinned: m.pinned ?? false,
        source: m.source,
        agentId: m.agentId,
        color: m.color,
        attachment: m.attachment,
      })),
    }));

    return { tabs, activeTabId: savedActive || tabs[0].id };
  } catch {
    return null;
  }
}

// ─── Pinned Messages Section ──────────────────────────────────────────────────

interface PinnedSectionProps {
  messages: Message[];
  onScrollTo: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}

function PinnedSection({ messages, onScrollTo, onUnpin }: PinnedSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pinned = messages.filter((m) => m.pinned);
  if (pinned.length === 0) return null;

  return (
    <div className="border-b bg-amber-50/50 dark:bg-amber-950/20 flex-shrink-0">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <Pin className="h-3 w-3" />
        <span>Pinned ({pinned.length})</span>
        <span className="ml-auto">
          {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {pinned.map((msg) => (
            <div
              key={msg.id}
              className="flex items-center gap-2 group/pin"
            >
              <button
                className="flex-1 text-left text-xs text-muted-foreground hover:text-foreground truncate py-0.5"
                onClick={() => onScrollTo(msg.id)}
                title="Jump to message"
              >
                <span className="font-medium text-amber-600 dark:text-amber-400 mr-1">
                  {msg.role === 'user' ? '👤' : '🤖'}
                </span>
                {msg.content.trim().slice(0, 50)}{msg.content.trim().length > 50 ? '…' : ''}
              </button>
              <button
                className="opacity-0 group-hover/pin:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={() => onUnpin(msg.id)}
                title="Unpin"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Quick Commands Dropdown ──────────────────────────────────────────────────

interface QuickCommandsDropdownProps {
  inputValue: string;
  onSelect: (command: string) => void;
  onClose: () => void;
  selectedIndex: number;
}

function QuickCommandsDropdown({ inputValue, onSelect, onClose, selectedIndex }: QuickCommandsDropdownProps) {
  const filtered = QUICK_COMMANDS.filter((cmd) =>
    cmd.name.startsWith(inputValue.split(' ')[0])
  );

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
      <div className="p-1">
        {filtered.map((cmd, idx) => (
          <button
            key={cmd.name}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors ${
              idx === selectedIndex
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            }`}
            onClick={() => onSelect(cmd.name)}
            onMouseDown={(e) => e.preventDefault()} // prevent input blur
          >
            <span className="font-mono font-medium text-primary">{cmd.name}</span>
            {cmd.args && (
              <span className="text-muted-foreground text-xs">{cmd.args}</span>
            )}
            <span className="text-muted-foreground text-xs ml-auto">{cmd.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Sessions Dropdown ────────────────────────────────────────────────────────

interface SessionItem {
  key: string;
  label: string;
  channel?: string;
  updatedAt?: string;
}

interface SessionsDropdownProps {
  sessions: SessionItem[];
  onSelect: (key: string, label: string) => void;
  onClose: () => void;
}

function SessionsDropdown({ sessions, onSelect, onClose }: SessionsDropdownProps) {
  if (sessions.length === 0) {
    return (
      <div className="fixed mt-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-[200] p-4 w-[480px]">
        <p className="text-xs text-muted-foreground text-center">No sessions found</p>
      </div>
    );
  }

  return (
    <div className="fixed mt-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-[200] w-[520px] max-h-[60vh] flex flex-col"
      style={{ top: 'auto', left: 'auto' }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b bg-muted/40 flex-shrink-0 flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} — sorted by last active
        </span>
        <span className="text-[10px] text-muted-foreground">Click to connect</span>
      </div>
      <div className="overflow-y-auto flex-1 p-1">
        {sessions.map((s) => (
          <button
            key={s.key}
            className="w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left hover:bg-accent transition-colors border border-transparent hover:border-border/50 mb-0.5"
            onClick={() => {
              onSelect(s.key, s.label);
              onClose();
            }}
          >
            <Radio className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {/* Row 1: label + channel badge */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">{s.label}</span>
                {s.channel && s.channel !== 'unknown' && (
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium flex-shrink-0 ${channelBadgeColor(s.channel)}`}>
                    {s.channel}
                  </span>
                )}
              </div>
              {/* Row 2: full session key */}
              <div className="text-[11px] text-muted-foreground font-mono break-all leading-relaxed">{s.key}</div>
              {/* Row 3: last active */}
              {s.updatedAt && (
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500/60 flex-shrink-0" />
                  Last active: {new Date(s.updatedAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Group Chat Message ───────────────────────────────────────────────────────

interface GroupChatMessageProps {
  message: Message;
  agentIndex: number;
}

function GroupChatMessageBubble({ message, agentIndex }: GroupChatMessageProps) {
  if (!message) return null;
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[75%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const agentId = message.agentId || 'Agent';
  const safeIndex = typeof agentIndex === 'number' && !isNaN(agentIndex) ? agentIndex : 0;
  const colorKey = getAgentColor(safeIndex);
  const styles = GROUP_COLOR_STYLES[colorKey];
  const initials = agentId.slice(0, 2).toUpperCase();

  return (
    <div className="flex gap-2 mb-3">
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${styles.avatar}`}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        {/* Agent label */}
        <div className={`text-[10px] font-semibold mb-1 ${styles.label}`}>
          {agentId}
        </div>
        {/* Bubble */}
        <div className={`rounded-2xl rounded-tl-sm px-4 py-2 text-sm border ${styles.bubble} max-w-[85%]`}>
          {message.content}
        </div>
      </div>
    </div>
  );
}

// ─── Group Chat Panel ─────────────────────────────────────────────────────────

interface GroupChatPanelProps {
  tab: ChatTab;
  onUpdateTab: (tabId: string, updater: (tab: ChatTab) => ChatTab) => void;
  onGroupSend: (tabId: string) => void;
  onClear: (tabId: string) => void;
  compact?: boolean;
}

function GroupChatPanel({ tab, onUpdateTab, onGroupSend, onClear, compact = false }: GroupChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [agentInput, setAgentInput] = useState('');
  const px = compact ? 'px-2' : 'px-3 md:px-6';

  // Build agent index map for color assignment (stable per session)
  const agentIndexMap = useRef<Map<string, number>>(new Map());
  const getAgentIndex = (agentId: string) => {
    if (!agentIndexMap.current.has(agentId)) {
      const agents = tab.groupAgents || [];
      const idx = agents.indexOf(agentId);
      agentIndexMap.current.set(agentId, idx >= 0 ? idx : agentIndexMap.current.size);
    }
    return agentIndexMap.current.get(agentId)!;
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tab.messages]);

  // Sync agent index map when groupAgents changes
  useEffect(() => {
    agentIndexMap.current = new Map();
    (tab.groupAgents || []).forEach((agentId, idx) => {
      agentIndexMap.current.set(agentId, idx);
    });
  }, [tab.groupAgents]);

  const groupAgents = tab.groupAgents ?? [];
  const canStart = groupAgents.length >= 2;
  const isStarted = tab.groupStarted && groupAgents.length >= 2;

  const handleAddAgent = () => {
    const trimmed = agentInput.trim();
    if (!trimmed) return;
    if (groupAgents.length >= 6) return;
    if (groupAgents.includes(trimmed)) return;
    onUpdateTab(tab.id, (t) => ({
      ...t,
      groupAgents: [...(t.groupAgents || []), trimmed],
    }));
    setAgentInput('');
  };

  const handleRemoveAgent = (agentId: string) => {
    onUpdateTab(tab.id, (t) => ({
      ...t,
      groupAgents: (t.groupAgents || []).filter((a) => a !== agentId),
    }));
  };

  const handleStartGroupChat = () => {
    if (!canStart) return;
    onUpdateTab(tab.id, (t) => ({
      ...t,
      groupStarted: true,
      messages: [],
    }));
  };

  const handleAutoRoundToggle = () => {
    onUpdateTab(tab.id, (t) => ({ ...t, autoRound: !t.autoRound }));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Group setup panel (when not started) */}
      {!isStarted ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-base font-semibold mb-1">Multi-Agent Group Chat</h3>
          <p className="text-sm text-muted-foreground mb-6 text-center">
            Add 2–6 agents. They will discuss in sequence, each seeing the others&apos; replies.
          </p>

          {/* Agent chips */}
          <div className="w-full max-w-md mb-4">
            <div className="flex flex-wrap gap-2 min-h-[36px] mb-3">
              {groupAgents.map((agentId, idx) => {
                const colorKey = getAgentColor(idx);
                const styles = GROUP_COLOR_STYLES[colorKey];
                return (
                  <span
                    key={agentId}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${styles.bubble} ${styles.label}`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${styles.avatar}`}>
                      {agentId.slice(0, 1).toUpperCase()}
                    </span>
                    {agentId}
                    <button
                      onClick={() => handleRemoveAgent(agentId)}
                      className="ml-0.5 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              {groupAgents.length === 0 && (
                <span className="text-xs text-muted-foreground italic">No agents added yet</span>
              )}
            </div>

            {/* Add agent input */}
            {groupAgents.length < 6 && (
              <div className="flex gap-2">
                <Input
                  className="flex-1 h-8 text-sm"
                  placeholder="Agent ID (e.g. main, tonic-ai-tech)"
                  value={agentInput}
                  onChange={(e) => setAgentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddAgent();
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleAddAgent}
                  disabled={!agentInput.trim() || groupAgents.includes(agentInput.trim())}
                >
                  Add
                </Button>
              </div>
            )}
            {groupAgents.length >= 6 && (
              <p className="text-xs text-muted-foreground">Maximum 6 agents reached</p>
            )}
          </div>

          {/* Auto Round toggle */}
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={handleAutoRoundToggle}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                tab.autoRound ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  tab.autoRound ? 'translate-x-4.5' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span className="text-sm text-muted-foreground">Auto Round</span>
            <span className="text-xs text-muted-foreground/60">(agents continue discussing after your message)</span>
          </div>

          <Button
            onClick={handleStartGroupChat}
            disabled={!canStart}
            className="gap-2"
          >
            <Users className="h-4 w-4" />
            Start Group Chat
            {!canStart && <span className="text-xs opacity-60">(need ≥2 agents)</span>}
          </Button>
        </div>
      ) : (
        <>
          {/* Active group chat */}
          {/* Group info header */}
          <div className="px-3 py-1.5 border-b bg-muted/30 flex-shrink-0 flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap flex-1">
              {groupAgents.map((agentId, idx) => {
                const colorKey = getAgentColor(idx);
                const styles = GROUP_COLOR_STYLES[colorKey];
                return (
                  <span
                    key={agentId}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${styles.avatar}`}
                  >
                    {agentId}
                  </span>
                );
              })}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Auto round indicator */}
              {tab.autoRound && (
                <span className="flex items-center gap-1 text-[10px] text-primary">
                  <RefreshCw className="h-3 w-3" />
                  Auto Round
                </span>
              )}
              {/* Clear */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => onClear(tab.id)}
                title="Clear conversation"
                disabled={tab.messages.length === 0}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
              {/* Reset group */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                onClick={() => onUpdateTab(tab.id, (t) => ({ ...t, groupStarted: false, messages: [] }))}
                title="Change agents"
              >
                <Users className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <div className={`${px} py-4`}>
              {tab.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Users className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Group chat ready</p>
                  <p className="text-xs mt-1 opacity-60">
                    {groupAgents.join(' · ')}
                  </p>
                </div>
              ) : (
                <div className={`space-y-1 ${compact ? '' : 'max-w-3xl mx-auto'}`}>
                  {tab.messages.map((msg) => {
                    const agentIdx = msg.agentId
                      ? getAgentIndex(msg.agentId)
                      : 0;
                    return (
                      <GroupChatMessageBubble
                        key={msg.id}
                        message={msg}
                        agentIndex={agentIdx}
                      />
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </div>

          {/* Input */}
          <div className="border-t p-2 bg-card flex-shrink-0">
            <form
              className="flex gap-1.5 items-center"
              onSubmit={(e) => {
                e.preventDefault();
                onGroupSend(tab.id);
              }}
            >
              <Input
                className="flex-1 h-8 text-sm"
                placeholder="Message the group..."
                value={tab.input}
                onChange={(e) =>
                  onUpdateTab(tab.id, (t) => ({ ...t, input: e.target.value }))
                }
                disabled={tab.streaming}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onGroupSend(tab.id);
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                disabled={tab.streaming || !tab.input.trim()}
              >
                {tab.streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

// ─── SinglePanel ──────────────────────────────────────────────────────────────

interface SinglePanelProps {
  tab: ChatTab;
  onUpdateTab: (tabId: string, updater: (tab: ChatTab) => ChatTab) => void;
  onSend: (tabId: string) => void;
  onGroupSend: (tabId: string) => void;
  onClear: (tabId: string) => void;
  onAttachClick: (tabId: string) => void;
  onAddTab: () => void;
  compact?: boolean;
}

function SinglePanel({
  tab,
  onUpdateTab,
  onSend,
  onGroupSend,
  onClear,
  onAttachClick,
  onAddTab,
  compact = false,
}: SinglePanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [showCommands, setShowCommands] = useState(false);
  const [commandSelectedIdx, setCommandSelectedIdx] = useState(0);
  // Channel mode state
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sessionKeyInput, setSessionKeyInput] = useState(tab.sessionKey || '');
  const sessionKeyInputRef = useRef<string>(tab.sessionKey || '');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isChannelMode = tab.mode === 'channel';
  const isGroupMode = tab.mode === 'group';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tab.messages]);

  // Keep sessionKeyInput in sync when tab.sessionKey changes externally
  useEffect(() => {
    if (tab.sessionKey && tab.sessionKey !== sessionKeyInputRef.current) {
      setSessionKeyInput(tab.sessionKey);
      sessionKeyInputRef.current = tab.sessionKey;
    }
  }, [tab.sessionKey]);

  // Start/stop polling when session key or mode changes
  useEffect(() => {
    if (tab.mode === 'channel' && tab.sessionKey) {
      startPolling(tab.id, tab.sessionKey);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.mode, tab.sessionKey, tab.id]);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const startPolling = (tabId: string, sessionKey: string) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        onUpdateTab(tabId, (t) => {
          const since = t.lastPollTimestamp;
          void pollMessages(tabId, sessionKey, since);
          return t;
        });
      } catch {
        // ignore polling errors
      }
    }, POLL_INTERVAL_MS);
  };

  const pollMessages = async (tabId: string, sessionKey: string, since?: string) => {
    try {
      const url = since
        ? `/api/sessions/${encodeURIComponent(sessionKey)}/poll?since=${encodeURIComponent(since)}`
        : `/api/sessions/${encodeURIComponent(sessionKey)}/poll`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as { messages?: NormalizedMsg[] };
      const newMsgs = data.messages || [];
      if (newMsgs.length === 0) return;

      onUpdateTab(tabId, (t) => {
        const existingIds = new Set(t.messages.map((m) => m.id));
        const toAdd: Message[] = newMsgs
          .filter((m: NormalizedMsg) => !existingIds.has(m.id))
          .map((m: NormalizedMsg) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: new Date(m.timestamp),
            source: m.source,
          }));

        if (toAdd.length === 0) return t;

        const lastMsg = toAdd[toAdd.length - 1];
        return {
          ...t,
          messages: [...t.messages, ...toAdd],
          lastPollTimestamp: lastMsg.timestamp.toISOString(),
        };
      });
    } catch {
      // ignore
    }
  };

  interface NormalizedMsg {
    id: string;
    role: string;
    content: string;
    timestamp: string;
    source?: string;
  }

  const loadSessionHistory = async (tabId: string, sessionKey: string) => {
    setLoadingHistory(true);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionKey)}/history?limit=50`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json() as { messages?: NormalizedMsg[] };
      const msgs = data.messages || [];

      const lastMsg = msgs[msgs.length - 1];

      onUpdateTab(tabId, (t) => ({
        ...t,
        messages: msgs.map((m: NormalizedMsg) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.timestamp),
          source: m.source,
        })),
        sessionKey,
        lastPollTimestamp: lastMsg?.timestamp,
        label: sessionKey.split(':').slice(1, 3).join(' / ') || sessionKey,
      }));
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleLoadSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as { sessions?: SessionItem[] };
      setSessions(data.sessions || []);
      setShowSessions(true);
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSelectSession = (key: string, label: string) => {
    setSessionKeyInput(key);
    sessionKeyInputRef.current = key;
    onUpdateTab(tab.id, (t) => ({
      ...t,
      sessionKey: key,
      label: label,
      messages: [],
    }));
    void loadSessionHistory(tab.id, key);
  };

  const handleConnectSession = () => {
    const key = sessionKeyInput.trim();
    if (!key) return;
    sessionKeyInputRef.current = key;
    onUpdateTab(tab.id, (t) => ({
      ...t,
      sessionKey: key,
      label: key.split(':').slice(1, 3).join(' / ') || key,
      messages: [],
    }));
    void loadSessionHistory(tab.id, key);
  };

  const px = compact ? 'px-2' : 'px-3 md:px-6';

  // ── Hooks that must come before any conditional return ─────────────────────
  const handleInputChange = (value: string) => {
    onUpdateTab(tab.id, (t) => ({ ...t, input: value }));
    if (value.startsWith('/')) {
      setShowCommands(true);
      setCommandSelectedIdx(0);
    } else {
      setShowCommands(false);
    }
  };

  const getFilteredCommands = () =>
    QUICK_COMMANDS.filter((cmd) =>
      cmd.name.startsWith(tab.input.split(' ')[0])
    );

  const executeCommand = useCallback((cmdName: string) => {
    setShowCommands(false);

    if (cmdName === '/clear') {
      onClear(tab.id);
      onUpdateTab(tab.id, (t) => ({ ...t, input: '' }));
    } else if (cmdName === '/new') {
      onAddTab();
      onUpdateTab(tab.id, (t) => ({ ...t, input: '' }));
    } else if (cmdName === '/help') {
      const helpText = QUICK_COMMANDS.map(
        (c) => `${c.name}${c.args ? ' ' + c.args : ''} — ${c.description}`
      ).join('\n');
      const helpMsg: Message = {
        id: `msg-${Date.now()}-system`,
        role: 'assistant',
        content: `**Available Commands:**\n\n${helpText}`,
        timestamp: new Date(),
      };
      onUpdateTab(tab.id, (t) => ({
        ...t,
        messages: [...t.messages, helpMsg],
        input: '',
      }));
    } else if (cmdName === '/agent') {
      onUpdateTab(tab.id, (t) => ({ ...t, input: '/agent ' }));
    } else {
      onUpdateTab(tab.id, (t) => ({ ...t, input: cmdName + ' ' }));
    }
  }, [tab.id, onClear, onAddTab, onUpdateTab]);

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showCommands) {
      const filtered = getFilteredCommands();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        executeCommand(filtered[commandSelectedIdx]?.name || filtered[0].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && tab.input.startsWith('/agent ')) {
      e.preventDefault();
      const newAgentId = tab.input.slice('/agent '.length).trim();
      if (newAgentId) {
        onUpdateTab(tab.id, (t) => ({ ...t, agentId: newAgentId, input: '' }));
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !showCommands) {
      e.preventDefault();
      onSend(tab.id);
    }
  };

  const handlePinMessage = useCallback((messageId: string) => {
    onUpdateTab(tab.id, (t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.id === messageId ? { ...m, pinned: !m.pinned } : m
      ),
    }));
  }, [tab.id, onUpdateTab]);

  const handleScrollToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'rounded-lg');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'rounded-lg');
      }, 2000);
    }
  }, []);

  // ── Group mode: render after ALL hooks are declared ────────────────────────
  if (isGroupMode) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-3 py-1.5 border-b bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2">
            <ModeToggle tab={tab} onUpdateTab={onUpdateTab} />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <GroupChatPanel
            tab={tab}
            onUpdateTab={onUpdateTab}
            onGroupSend={onGroupSend}
            onClear={onClear}
            compact={compact}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Agent / Channel / Group header */}
      <div className="px-3 py-1.5 border-b bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <ModeToggle tab={tab} onUpdateTab={onUpdateTab} />

          {!isChannelMode ? (
            /* Agent mode: agent ID input */
            <>
              <span className="text-xs text-muted-foreground whitespace-nowrap">ID:</span>
              <Input
                className="h-6 text-xs flex-1 min-w-0"
                placeholder="Agent ID (leave empty for default)"
                value={tab.agentId}
                onChange={(e) =>
                  onUpdateTab(tab.id, (t) => ({
                    ...t,
                    agentId: e.target.value,
                  }))
                }
              />
            </>
          ) : (
            /* Channel mode: session key input + Load Sessions */
            <div className="flex items-center gap-1 flex-1 min-w-0 relative">
              <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">Session:</span>
              <Input
                className="h-6 text-xs flex-1 min-w-0"
                placeholder="agent:main:telegram:..."
                value={sessionKeyInput}
                onChange={(e) => {
                  setSessionKeyInput(e.target.value);
                  sessionKeyInputRef.current = e.target.value;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnectSession();
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 flex-shrink-0"
                onClick={handleConnectSession}
                disabled={!sessionKeyInput.trim()}
              >
                Connect
              </Button>
              <div className="relative flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={handleLoadSessions}
                  disabled={loadingSessions}
                >
                  {loadingSessions ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      Load <ChevronDownIcon className="h-2.5 w-2.5 ml-0.5" />
                    </>
                  )}
                </Button>
                {showSessions && (
                  <SessionsDropdown
                    sessions={sessions}
                    onSelect={handleSelectSession}
                    onClose={() => setShowSessions(false)}
                  />
                )}
              </div>
              {tab.sessionKey && (
                <span className="flex items-center gap-1 text-[10px] text-green-500 flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              )}
            </div>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onClear(tab.id)}
            title="Clear conversation"
            disabled={tab.messages.length === 0}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Pinned messages section */}
      <PinnedSection
        messages={tab.messages}
        onScrollTo={handleScrollToMessage}
        onUnpin={handlePinMessage}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className={`${px} py-4`}>
          {loadingHistory ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading history...</span>
            </div>
          ) : tab.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              {isChannelMode ? (
                <>
                  <Radio className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Channel mode</p>
                  <p className="text-xs mt-1 opacity-60">
                    {tab.sessionKey
                      ? 'No messages yet'
                      : 'Enter a session key or click "Load" to browse sessions'}
                  </p>
                </>
              ) : (
                <>
                  <Bot className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Start a conversation</p>
                  <p className="text-xs mt-1 opacity-60">Attach images or files with 📎</p>
                  <p className="text-xs mt-1 opacity-60">Type <kbd className="px-1 py-0.5 rounded bg-muted border text-[10px]">/</kbd> for commands</p>
                </>
              )}
            </div>
          ) : (
            <div className={`space-y-3 ${compact ? '' : 'max-w-3xl mx-auto'}`}>
              {tab.messages.map((msg) => (
                <div
                  key={msg.id}
                  ref={(el) => {
                    if (el) messageRefs.current.set(msg.id, el);
                    else messageRefs.current.delete(msg.id);
                  }}
                  className="transition-all duration-300"
                >
                  {/* Channel source badge */}
                  {msg.source && (
                    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium mb-0.5 ${channelBadgeColor(msg.source)}`}>
                      <Radio className="h-2 w-2" />
                      {msg.source}
                    </div>
                  )}
                  {msg.role === 'user' && msg.attachment && (
                    <div className="flex justify-end mb-1">
                      {msg.attachment.type === 'image' && msg.attachment.preview ? (
                        <div className="rounded-lg overflow-hidden border max-w-[150px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={msg.attachment.preview}
                            alt={msg.attachment.name}
                            className="max-w-full max-h-[120px] object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-xs">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">{msg.attachment.name}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <ChatMessage
                    message={msg}
                    isStreaming={tab.streaming && msg.id === tab.messages[tab.messages.length - 1]?.id}
                    onPin={handlePinMessage}
                  />
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Pending file preview (agent mode only) */}
      {!isChannelMode && tab.pendingFile && (
        <div className="border-t px-3 py-1.5 bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2">
            {tab.pendingFilePreview ? (
              <>
                <div className="rounded border overflow-hidden w-8 h-8 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tab.pendingFilePreview} alt={tab.pendingFile.name} className="w-full h-full object-cover" />
                </div>
                <span className="text-xs truncate flex-1">{tab.pendingFile.name}</span>
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-xs truncate flex-1">{tab.pendingFile.name}</span>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 flex-shrink-0"
              onClick={() => onUpdateTab(tab.id, (t) => ({ ...t, pendingFile: null, pendingFilePreview: null }))}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t p-2 bg-card flex-shrink-0">
        <div className="relative">
          {/* Quick commands dropdown (agent mode only) */}
          {!isChannelMode && showCommands && (
            <QuickCommandsDropdown
              inputValue={tab.input}
              onSelect={executeCommand}
              onClose={() => setShowCommands(false)}
              selectedIndex={commandSelectedIdx}
            />
          )}
          <form
            className="flex gap-1.5 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              if (!showCommands) onSend(tab.id);
            }}
          >
            {/* Attach button (agent mode only) */}
            {!isChannelMode && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                disabled={tab.streaming}
                onClick={() => onAttachClick(tab.id)}
                title="Attach image or file"
              >
                {tab.pendingFile ? (
                  isImageFile(tab.pendingFile) ? (
                    <ImageIcon className="h-4 w-4 text-primary" />
                  ) : (
                    <FileText className="h-4 w-4 text-primary" />
                  )
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </Button>
            )}
            <Input
              className="flex-1 h-8 text-sm"
              placeholder={
                isChannelMode
                  ? (tab.sessionKey ? 'Send message to channel...' : 'Connect to a session first')
                  : (tab.pendingFile ? 'Add a message (optional)...' : 'Type a message or / for commands...')
              }
              value={tab.input}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={tab.streaming || (isChannelMode && !tab.sessionKey)}
              onKeyDown={handleInputKeyDown}
              onBlur={() => {
                setTimeout(() => setShowCommands(false), 150);
              }}
            />
            <Button
              type="submit"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              disabled={tab.streaming || (!tab.input.trim() && !tab.pendingFile) || (isChannelMode && !tab.sessionKey)}
            >
              {tab.streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Mode Toggle (shared) ─────────────────────────────────────────────────────

interface ModeToggleProps {
  tab: ChatTab;
  onUpdateTab: (tabId: string, updater: (tab: ChatTab) => ChatTab) => void;
}

function ModeToggle({ tab, onUpdateTab }: ModeToggleProps) {
  return (
    <div className="flex items-center rounded-md border overflow-hidden flex-shrink-0">
      <button
        className={`px-2 py-1 text-[10px] font-medium transition-colors ${
          tab.mode === 'agent'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={() => onUpdateTab(tab.id, (t) => ({ ...t, mode: 'agent' }))}
      >
        Agent
      </button>
      <button
        className={`px-2 py-1 text-[10px] font-medium transition-colors ${
          tab.mode === 'channel'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={() => onUpdateTab(tab.id, (t) => ({ ...t, mode: 'channel' }))}
      >
        Channel
      </button>
      <button
        className={`px-2 py-1 text-[10px] font-medium transition-colors ${
          tab.mode === 'group'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={() => onUpdateTab(tab.id, (t) => ({ ...t, mode: 'group' }))}
      >
        Group
      </button>
    </div>
  );
}

// ─── Inline Tab Label Edit ────────────────────────────────────────────────────

interface InlineTabLabelProps {
  label: string;
  onRename: (newLabel: string) => void;
}

function InlineTabLabel({ label, onRename }: InlineTabLabelProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setValue(label);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const confirm = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== label) {
      onRename(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    } else if (e.key === 'Escape') {
      setEditing(false);
      setValue(label);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="bg-transparent border-b border-primary outline-none text-xs w-[80px] max-w-[100px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={confirm}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="truncate max-w-[100px] cursor-text"
      onDoubleClick={startEdit}
      title="Double-click to rename"
    >
      {label}
    </span>
  );
}

// ─── Error Boundary ────────────────────────────────────────────────────────────

class ChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Chat crashed:', error.message, error.stack, info.componentStack);
    try { localStorage.removeItem('clawdeck-chat-tabs'); } catch {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-8">
          <p className="text-sm font-medium text-destructive">Chat encountered an error</p>
          <pre className="text-[10px] text-center bg-muted rounded p-2 max-w-md overflow-auto max-h-32 text-left whitespace-pre-wrap">{this.state.error}</pre>
          <button
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
            onClick={() => {
              try { localStorage.removeItem('clawdeck-chat-tabs'); } catch {}
              this.setState({ hasError: false, error: '' });
              window.location.reload();
            }}
          >
            Reset &amp; Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

function ChatPage() {
  const searchParams = useSearchParams();
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [splitView, setSplitView] = useState(false);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeFileTabRef = useRef<string>('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // tabsRef: always points to current tabs to avoid stale closures in callbacks
  const tabsRef = useRef<ChatTab[]>([]);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const agentId = searchParams.get('agent') || '';
    const saved = loadTabs();
    if (saved) {
      setTabs(saved.tabs);
      setActiveTab(saved.activeTabId || saved.tabs[0].id);
    } else {
      const initial = createTab(agentId);
      setTabs([initial]);
      setActiveTab(initial.id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced save ──────────────────────────────────────────────────────────
  const scheduleSave = useCallback((tabs: ChatTab[], activeTabId: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTabs(tabs, activeTabId);
    }, 500);
  }, []);

  useEffect(() => {
    if (tabs.length === 0) return;
    scheduleSave(tabs, activeTab);
  }, [tabs, activeTab, scheduleSave]);

  // Keep tabsRef in sync so callbacks always read fresh state
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // ── Tab management ──────────────────────────────────────────────────────────

  const updateTab = useCallback((tabId: string, updater: (tab: ChatTab) => ChatTab) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
  }, []);

  const addTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) return;
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTab(tab.id);
  }, [tabs.length]);

  const clearMessages = useCallback((tabId: string) => {
    updateTab(tabId, (t) => ({ ...t, messages: [] }));
    setTimeout(() => {
      setTabs((prev) => {
        saveTabs(prev, activeTab);
        return prev;
      });
    }, 0);
  }, [activeTab, updateTab]);

  const closeTab = useCallback((tabId: string) => {
    abortRefs.current.get(tabId)?.abort();
    abortRefs.current.delete(tabId);
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        const newTab = createTab();
        setTimeout(() => setActiveTab(newTab.id), 0);
        return [newTab];
      }
      setActiveTab((cur) => {
        if (cur === tabId) return remaining[0].id;
        return cur;
      });
      return remaining;
    });
  }, []);

  const renameTab = useCallback((tabId: string, newLabel: string) => {
    updateTab(tabId, (t) => ({ ...t, label: newLabel }));
  }, [updateTab]);

  // ── File attach ─────────────────────────────────────────────────────────────

  const handleAttachClick = useCallback((tabId: string) => {
    activeFileTabRef.current = tabId;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const tabId = activeFileTabRef.current || activeTab;
    if (!file || !tabId) return;

    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        updateTab(tabId, (t) => ({
          ...t,
          pendingFile: file,
          pendingFilePreview: ev.target?.result as string,
        }));
      };
      reader.readAsDataURL(file);
    } else {
      updateTab(tabId, (t) => ({ ...t, pendingFile: file, pendingFilePreview: null }));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [activeTab, updateTab]);

  // ── Group Chat Send ─────────────────────────────────────────────────────────

  const sendGroupMessage = useCallback(async (tabId: string) => {
    // ALWAYS read fresh state from tabsRef to avoid stale closures
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    if (!tab.input.trim() || tab.streaming) return;
    if (!tab.groupAgents || tab.groupAgents.length < 2) return;

    const userContent = tab.input.trim();
    const groupAgents = [...tab.groupAgents]; // snapshot agents at call time
    const autoRound = tab.autoRound ?? false; // snapshot autoRound at call time

    const isFirstMessage = tab.messages.length === 0;
    const newLabel = isFirstMessage ? autoLabel(userContent) : undefined;

    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: userContent,
      timestamp: new Date(),
    };

    updateTab(tabId, (t) => ({
      ...t,
      messages: [...t.messages, userMsg],
      input: '',
      streaming: true,
      ...(newLabel ? { label: newLabel } : {}),
    }));

    // sendRound: takes explicit agents param — no outer tab closure
    const sendRound = async (prompt: string, historyMessages: Message[], agents: string[]) => {
      const historyPayload = historyMessages.map((m) => ({
        role: m.role,
        content: m.content,
        agentId: m.agentId,
      }));

      const res = await fetch('/api/groupchat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          agents,
          message: prompt,
          history: historyPayload,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Group chat request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const chunk of lines) {
          const line = chunk.trim();
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          try {
            const event = JSON.parse(jsonStr) as {
              agentId?: string;
              content?: string;
              done?: boolean;
            };
            if (event.done) continue;
            if (event.agentId && event.content !== undefined) {
              const agentIdx = agents.indexOf(event.agentId);
              const color = getAgentColor(agentIdx >= 0 ? agentIdx : 0);
              const agentMsg: Message = {
                id: `msg-${Date.now()}-${event.agentId}-${Math.random()}`,
                role: 'assistant',
                content: event.content,
                timestamp: new Date(),
                agentId: event.agentId,
                color,
              };
              updateTab(tabId, (t) => ({
                ...t,
                messages: [...t.messages, agentMsg],
              }));
            }
          } catch {
            // skip malformed
          }
        }
      }
    };

    try {
      // Read fresh history from tabsRef before sending (includes userMsg just added)
      const historyBeforeUser = tabsRef.current.find((t) => t.id === tabId)?.messages ?? [];
      await sendRound(userContent, historyBeforeUser, groupAgents);

      if (autoRound) {
        const allMessages = tabsRef.current.find((t) => t.id === tabId)?.messages ?? [];
        await sendRound('[Continue the discussion]', allMessages, groupAgents);
      }
    } catch (err) {
      console.error('Group chat error:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      updateTab(tabId, (t) => ({
        ...t,
        messages: [...t.messages, {
          id: `msg-${Date.now()}-err`,
          role: 'assistant' as const,
          content: `Error: ${errorMsg}`,
          timestamp: new Date(),
        }],
      }));
    } finally {
      updateTab(tabId, (t) => ({ ...t, streaming: false }));
    }
  }, [updateTab]); // Only updateTab as dependency

  // ── Send message (agent/channel) ────────────────────────────────────────────

  const sendMessage = useCallback(async (tabId: string) => {
    // Use tabsRef.current to always get fresh state (avoids stale closure)
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab || (!tab.input.trim() && !tab.pendingFile) || tab.streaming) return;

    // Channel mode: send via sessions API
    if (tab.mode === 'channel') {
      if (!tab.sessionKey || !tab.input.trim()) return;
      const userContent = tab.input.trim();

      const userMsg: Message = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: userContent,
        timestamp: new Date(),
      };

      updateTab(tabId, (t) => ({
        ...t,
        messages: [...t.messages, userMsg],
        input: '',
        streaming: true,
      }));

      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(tab.sessionKey)}/send`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ message: userContent }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Send failed' }));
          updateTab(tabId, (t) => ({
            ...t,
            streaming: false,
            messages: [
              ...t.messages,
              {
                id: `msg-${Date.now()}-err`,
                role: 'assistant' as const,
                content: `Error: ${(err as { error?: string }).error || 'Unknown error'}`,
                timestamp: new Date(),
              },
            ],
          }));
        } else {
          const data = await res.json().catch(() => ({})) as { reply?: string };
          if (data.reply) {
            updateTab(tabId, (t) => ({
              ...t,
              streaming: false,
              messages: [...t.messages, {
                id: `msg-${Date.now()}-reply`,
                role: 'assistant' as const,
                content: data.reply!,
                timestamp: new Date(),
                source: tab.sessionKey?.split(':')?.[2],
              }],
            }));
          } else {
            updateTab(tabId, (t) => ({ ...t, streaming: false }));
          }
        }
      } catch {
        updateTab(tabId, (t) => ({ ...t, streaming: false }));
      }
      return;
    }

    // Agent mode: existing logic
    const userContent = tab.input.trim();
    const pendingFile = tab.pendingFile;
    const pendingFilePreview = tab.pendingFilePreview;

    const isFirstMessage = tab.messages.length === 0;

    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: userContent || (pendingFile ? `[Attached: ${pendingFile.name}]` : ''),
      timestamp: new Date(),
      attachment: pendingFile
        ? {
            type: isImageFile(pendingFile) ? 'image' : 'file',
            name: pendingFile.name,
            preview: pendingFilePreview || undefined,
          }
        : undefined,
    };

    const newLabel = isFirstMessage && userContent ? autoLabel(userContent) : undefined;

    updateTab(tabId, (t) => ({
      ...t,
      messages: [...t.messages, userMsg],
      input: '',
      streaming: true,
      pendingFile: null,
      pendingFilePreview: null,
      ...(newLabel ? { label: newLabel } : {}),
    }));

    const assistantMsgId = `msg-${Date.now()}-assistant`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    updateTab(tabId, (t) => ({
      ...t,
      messages: [...t.messages, assistantMsg],
    }));

    const controller = new AbortController();
    abortRefs.current.set(tabId, controller);

    try {
      const agentId = tab.agentId || 'default';
      let res: Response;

      if (pendingFile) {
        const formData = new FormData();
        formData.append('text', userContent);
        formData.append('file', pendingFile);
        res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat/rich`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
          signal: controller.signal,
        });
      } else {
        const messages = [...tab.messages, userMsg].map(({ role, content }) => ({ role, content }));
        res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });
      }

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Stream failed' }));
        updateTab(tabId, (t) => ({
          ...t,
          streaming: false,
          messages: t.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${(err as { error?: string }).error || 'Unknown error'}` }
              : m
          ),
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              updateTab(tabId, (t) => ({
                ...t,
                messages: t.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
                ),
              }));
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        updateTab(tabId, (t) => ({
          ...t,
          messages: t.messages.map((m) =>
            m.id === assistantMsgId && m.content === ''
              ? { ...m, content: 'Connection error. Please try again.' }
              : m
          ),
        }));
      }
    } finally {
      abortRefs.current.delete(tabId);
      updateTab(tabId, (t) => ({ ...t, streaming: false }));
    }
  }, [updateTab]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (tabs.length === 0) return null;

  const canAddTab = tabs.length < (splitView ? MAX_SPLIT_PANELS : MAX_TABS);
  const activeTabData = tabs.find((t) => t.id === activeTab);
  void activeTabData; // used implicitly via tabs array

  return (
    <div className="h-full flex flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,.pdf,.txt,.md,.json"
        onChange={handleFileChange}
      />

      {/* ── Tab Bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b bg-card px-2 overflow-x-auto flex-shrink-0">
        {!splitView && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-w-0">
            <TabsList className="h-10 bg-transparent gap-0 p-0 flex-shrink-0">
              {tabs.map((tab) => (
                <div key={tab.id} className="flex items-center">
                  <TabsTrigger
                    value={tab.id}
                    className="relative h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 text-xs max-w-[160px]"
                  >
                    {tab.mode === 'channel' ? (
                      <Radio className="h-3 w-3 mr-1.5 flex-shrink-0 text-blue-500" />
                    ) : tab.mode === 'group' ? (
                      <Users className="h-3 w-3 mr-1.5 flex-shrink-0 text-purple-500" />
                    ) : (
                      <Bot className="h-3 w-3 mr-1.5 flex-shrink-0" />
                    )}
                    <InlineTabLabel
                      label={tab.label}
                      onRename={(newLabel) => renameTab(tab.id, newLabel)}
                    />
                    {tab.streaming && (
                      <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    )}
                    {tab.mode === 'channel' && tab.sessionKey && (
                      <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    )}
                    <button
                      className="ml-2 rounded-full hover:bg-accent p-0.5 flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </TabsTrigger>
                </div>
              ))}
            </TabsList>
          </Tabs>
        )}

        {splitView && (
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className="flex items-center gap-1 px-2 py-1 rounded bg-muted/60 text-xs flex-shrink-0"
              >
                {tab.mode === 'channel' ? (
                  <Radio className="h-3 w-3 text-blue-500" />
                ) : tab.mode === 'group' ? (
                  <Users className="h-3 w-3 text-purple-500" />
                ) : (
                  <Bot className="h-3 w-3" />
                )}
                <InlineTabLabel
                  label={tab.label}
                  onRename={(newLabel) => renameTab(tab.id, newLabel)}
                />
                {tab.streaming && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                )}
                {tab.mode === 'channel' && tab.sessionKey && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                )}
                <button
                  className="rounded-full hover:bg-accent p-0.5"
                  onClick={() => closeTab(tab.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add tab + Split view toggle */}
        <div className="flex items-center gap-1 flex-shrink-0 ml-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={addTab}
            disabled={!canAddTab}
            title={`New chat tab (max ${splitView ? MAX_SPLIT_PANELS : MAX_TABS})`}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant={splitView ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={() => setSplitView((v) => !v)}
            title={splitView ? 'Switch to tab mode' : 'Switch to split view (up to 8 panels)'}
          >

            {splitView ? <Rows3 className="h-4 w-4" /> : <LayoutTemplate className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ── Content Area ──────────────────────────────────────────────────────── */}

      {splitView ? (
        <div className={`flex-1 grid ${splitGridClass(tabs.length)} gap-px bg-border overflow-hidden`}>
          {tabs.map((tab) => (
            <div key={tab.id} className="bg-background overflow-hidden flex flex-col min-h-0">
              <div className="px-2 py-1 border-b bg-card/80 flex items-center gap-1.5 flex-shrink-0">
                {tab.mode === 'channel' ? (
                  <Radio className="h-3 w-3 text-blue-500 flex-shrink-0" />
                ) : tab.mode === 'group' ? (
                  <Users className="h-3 w-3 text-purple-500 flex-shrink-0" />
                ) : (
                  <Bot className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-xs font-medium truncate flex-1">{tab.label}</span>
                {tab.mode === 'agent' && tab.agentId && (
                  <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[60px]">
                    {tab.agentId}
                  </span>
                )}
                {tab.mode === 'channel' && tab.sessionKey && (
                  <span className="flex items-center gap-0.5 text-[9px] text-blue-500">
                    <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                    Live
                  </span>
                )}
                {tab.mode === 'group' && tab.groupStarted && (
                  <span className="flex items-center gap-0.5 text-[9px] text-purple-500">
                    <span className="w-1 h-1 rounded-full bg-purple-500 animate-pulse" />
                    Group
                  </span>
                )}
              </div>
              <SinglePanel
                tab={tab}
                onUpdateTab={updateTab}
                onSend={sendMessage}
                onGroupSend={sendGroupMessage}
                onClear={clearMessages}
                onAttachClick={handleAttachClick}
                onAddTab={addTab}
                compact
              />
            </div>
          ))}
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          {tabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=inactive]:hidden"
            >
              {/* Chat header */}
              <div className="px-4 py-2 border-b bg-card/50 flex items-center gap-2 flex-shrink-0">
                {tab.mode === 'channel' ? (
                  <Radio className="h-4 w-4 text-blue-500 flex-shrink-0" />
                ) : tab.mode === 'group' ? (
                  <Users className="h-4 w-4 text-purple-500 flex-shrink-0" />
                ) : (
                  <Bot className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-semibold leading-tight truncate">{tab.label}</span>
                  {tab.mode === 'agent' && tab.agentId && (
                    <span className="text-[10px] text-muted-foreground font-mono leading-tight">
                      Agent: {tab.agentId}
                    </span>
                  )}
                  {tab.mode === 'channel' && tab.sessionKey && (
                    <span className="text-[10px] text-blue-500 font-mono leading-tight truncate">
                      {tab.sessionKey}
                    </span>
                  )}
                  {tab.mode === 'group' && tab.groupAgents && tab.groupAgents.length > 0 && (
                    <span className="text-[10px] text-purple-500 font-mono leading-tight truncate">
                      {tab.groupAgents.join(' · ')}
                    </span>
                  )}
                </div>
                {tab.streaming && (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Streaming
                  </span>
                )}
                {tab.mode === 'channel' && tab.sessionKey && (
                  <span className="flex items-center gap-1 text-[10px] text-blue-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Live
                  </span>
                )}
                {tab.mode === 'group' && tab.groupStarted && (
                  <span className="flex items-center gap-1 text-[10px] text-purple-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                    Group
                  </span>
                )}
              </div>

              <SinglePanel
                tab={tab}
                onUpdateTab={updateTab}
                onSend={sendMessage}
                onGroupSend={sendGroupMessage}
                onClear={clearMessages}
                onAttachClick={handleAttachClick}
                onAddTab={addTab}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

export default function ChatPageWrapper() {
  return (
    <ChatErrorBoundary>
      <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
        <ChatPage />
      </React.Suspense>
    </ChatErrorBoundary>
  );
}
