'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatMessage } from '@/components/chat/ChatMessage';
import {
  Plus, X, Send, Loader2, Bot, Paperclip, FileText,
  Image as ImageIcon, Trash2, LayoutTemplate, Rows3,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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
}

// ─── LocalStorage Schema ───────────────────────────────────────────────────────
// Key: 'clawdeck-chat-tabs'
// Value: JSON array of PersistedTab[]
interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string
  attachment?: { type: 'image' | 'file'; name: string; preview?: string };
}

interface PersistedTab {
  id: string;
  agentId: string;
  label: string;
  messages: PersistedMessage[];
}

const LS_KEY = 'clawdeck-chat-tabs';
const LS_ACTIVE_KEY = 'clawdeck-chat-active';
const MAX_TABS = 20;
const MAX_MESSAGES_PER_TAB = 100;
const MAX_SPLIT_PANELS = 8;

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
  };
}

function isImageFile(file: File): boolean {
  return (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    /\.(jpg|jpeg|png)$/i.test(file.name)
  );
}

/** Generate auto-label from first user message (max 20 chars) */
function autoLabel(text: string): string {
  const trimmed = text.trim().slice(0, 20);
  return trimmed.length < text.trim().length ? trimmed + '…' : trimmed;
}

/** Determine grid cols class based on panel count */
function splitGridClass(count: number): string {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-3';
  return 'grid-cols-4';
}

// ─── Persistence helpers ───────────────────────────────────────────────────────

function saveTabs(tabs: ChatTab[], activeTabId: string) {
  try {
    const persisted: PersistedTab[] = tabs.slice(0, MAX_TABS).map((tab) => ({
      id: tab.id,
      agentId: tab.agentId,
      label: tab.label,
      messages: tab.messages.slice(-MAX_MESSAGES_PER_TAB).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
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
      messages: (pt.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp), // restore Date object
        attachment: m.attachment,
      })),
    }));

    return { tabs, activeTabId: savedActive || tabs[0].id };
  } catch {
    return null;
  }
}

// ─── SinglePanel ──────────────────────────────────────────────────────────────
// Renders one chat panel (used in both tab mode and split view)

interface SinglePanelProps {
  tab: ChatTab;
  onUpdateTab: (tabId: string, updater: (tab: ChatTab) => ChatTab) => void;
  onSend: (tabId: string) => void;
  onClear: (tabId: string) => void;
  onAttachClick: (tabId: string) => void;
  compact?: boolean; // smaller padding in split view
}

function SinglePanel({
  tab,
  onUpdateTab,
  onSend,
  onClear,
  onAttachClick,
  compact = false,
}: SinglePanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tab.messages]);

  const px = compact ? 'px-2' : 'px-3 md:px-6';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Agent header */}
      <div className="px-3 py-1.5 border-b bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Agent:</span>
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className={`${px} py-4`}>
          {tab.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Bot className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">Start a conversation</p>
              <p className="text-xs mt-1 opacity-60">Attach images or files with 📎</p>
            </div>
          ) : (
            <div className={`space-y-3 ${compact ? '' : 'max-w-3xl mx-auto'}`}>
              {tab.messages.map((msg) => (
                <div key={msg.id}>
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
                  />
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Pending file preview */}
      {tab.pendingFile && (
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
        <form
          className="flex gap-1.5 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(tab.id);
          }}
        >
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
          <Input
            className="flex-1 h-8 text-sm"
            placeholder={tab.pendingFile ? 'Add a message (optional)...' : 'Type a message...'}
            value={tab.input}
            onChange={(e) => onUpdateTab(tab.id, (t) => ({ ...t, input: e.target.value }))}
            disabled={tab.streaming}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend(tab.id);
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            disabled={tab.streaming || (!tab.input.trim() && !tab.pendingFile)}
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
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const searchParams = useSearchParams();
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [splitView, setSplitView] = useState(false);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeFileTabRef = useRef<string>(''); // which tab triggered file picker
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Init: load from localStorage or create default tab ─────────────────────
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

  // ── Debounced save to localStorage ─────────────────────────────────────────
  const scheduleSave = useCallback((tabs: ChatTab[], activeTabId: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTabs(tabs, activeTabId);
    }, 500);
  }, []);

  // Save whenever tabs or activeTab changes
  useEffect(() => {
    if (tabs.length === 0) return;
    scheduleSave(tabs, activeTab);
  }, [tabs, activeTab, scheduleSave]);

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
    // Immediately clear localStorage for this tab
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

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || (!tab.input.trim() && !tab.pendingFile) || tab.streaming) return;

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

    // Auto-name tab on first user message
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
  }, [tabs, updateTab]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (tabs.length === 0) return null;

  const canAddTab = tabs.length < (splitView ? MAX_SPLIT_PANELS : MAX_TABS);
  const activeTabData = tabs.find((t) => t.id === activeTab);

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
                    <Bot className="h-3 w-3 mr-1.5 flex-shrink-0" />
                    <span className="truncate max-w-[100px]">{tab.label}</span>
                    {tab.streaming && (
                      <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
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
                <Bot className="h-3 w-3" />
                <span className="max-w-[80px] truncate">{tab.label}</span>
                {tab.streaming && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
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
        /* Split View: all panels in a grid */
        <div className={`flex-1 grid ${splitGridClass(tabs.length)} gap-px bg-border overflow-hidden`}>
          {tabs.map((tab) => (
            <div key={tab.id} className="bg-background overflow-hidden flex flex-col min-h-0">
              {/* Panel header showing session name */}
              <div className="px-2 py-1 border-b bg-card/80 flex items-center gap-1.5 flex-shrink-0">
                <Bot className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="text-xs font-medium truncate flex-1">{tab.label}</span>
                {tab.agentId && (
                  <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[60px]">
                    {tab.agentId}
                  </span>
                )}
              </div>
              <SinglePanel
                tab={tab}
                onUpdateTab={updateTab}
                onSend={sendMessage}
                onClear={clearMessages}
                onAttachClick={handleAttachClick}
                compact
              />
            </div>
          ))}
        </div>
      ) : (
        /* Tab Mode */
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          {tabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=inactive]:hidden"
            >
              {/* Chat header: agent ID + session name */}
              <div className="px-4 py-2 border-b bg-card/50 flex items-center gap-2 flex-shrink-0">
                <Bot className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-semibold leading-tight truncate">{tab.label}</span>
                  {tab.agentId && (
                    <span className="text-[10px] text-muted-foreground font-mono leading-tight">
                      Agent: {tab.agentId}
                    </span>
                  )}
                </div>
                {tab.streaming && (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Streaming
                  </span>
                )}
              </div>

              <SinglePanel
                tab={tab}
                onUpdateTab={updateTab}
                onSend={sendMessage}
                onClear={clearMessages}
                onAttachClick={handleAttachClick}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
