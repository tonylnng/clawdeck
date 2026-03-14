'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { Plus, X, Send, Loader2, Bot, Paperclip, FileText, Image as ImageIcon, Trash2 } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachment?: {
    type: 'image' | 'file';
    name: string;
    preview?: string; // data URL for images
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
  pendingFilePreview: string | null; // data URL for image preview
}

let tabCounter = 0;

function createTab(agentId: string = ''): ChatTab {
  tabCounter++;
  return {
    id: `tab-${tabCounter}`,
    agentId,
    label: agentId ? agentId.slice(0, 12) : `Chat ${tabCounter}`,
    messages: [],
    streaming: false,
    input: '',
    pendingFile: null,
    pendingFilePreview: null,
  };
}

function isImageFile(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png' ||
    /\.(jpg|jpeg|png)$/i.test(file.name);
}

export default function ChatPage() {
  const searchParams = useSearchParams();
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize with agent from query param if present
  useEffect(() => {
    const agentId = searchParams.get('agent') || '';
    const initial = createTab(agentId);
    setTabs([initial]);
    setActiveTab(initial.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateTab = (tabId: string, updater: (tab: ChatTab) => ChatTab) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
  };

  const addTab = () => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTab(tab.id);
  };

  const clearMessages = (tabId: string) => {
    updateTab(tabId, (t) => ({ ...t, messages: [] }));
  };

  const closeTab = (tabId: string) => {
    abortRefs.current.get(tabId)?.abort();
    abortRefs.current.delete(tabId);
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        const newTab = createTab();
        setTimeout(() => setActiveTab(newTab.id), 0);
        return [newTab];
      }
      return remaining;
    });
    setActiveTab((prev) => {
      const remaining = tabs.filter((t) => t.id !== tabId);
      return remaining[0]?.id || prev;
    });
  };

  const handleFileSelect = useCallback((tabId: string, file: File) => {
    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        updateTab(tabId, (t) => ({
          ...t,
          pendingFile: file,
          pendingFilePreview: e.target?.result as string,
        }));
      };
      reader.readAsDataURL(file);
    } else {
      updateTab(tabId, (t) => ({
        ...t,
        pendingFile: file,
        pendingFilePreview: null,
      }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearPendingFile = (tabId: string) => {
    updateTab(tabId, (t) => ({ ...t, pendingFile: null, pendingFilePreview: null }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sendMessage = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || (!tab.input.trim() && !tab.pendingFile) || tab.streaming) return;

    const userContent = tab.input.trim();
    const pendingFile = tab.pendingFile;
    const pendingFilePreview = tab.pendingFilePreview;

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

    updateTab(tabId, (t) => ({
      ...t,
      messages: [...t.messages, userMsg],
      input: '',
      streaming: true,
      pendingFile: null,
      pendingFilePreview: null,
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
        // Use multipart/form-data for rich messages with attachments
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
        // Plain text chat
        const messages = [...tab.messages, userMsg].map(({ role, content }) => ({
          role,
          content,
        }));

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
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + delta }
                    : m
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
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [tabs]);

  if (tabs.length === 0) return null;

  const activeTabData = tabs.find((t) => t.id === activeTab);

  return (
    <div className="h-full flex flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,.pdf,.txt,.md,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && activeTab) {
            handleFileSelect(activeTab, file);
          }
        }}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        {/* Tab Bar */}
        <div className="flex items-center border-b bg-card px-2 overflow-x-auto flex-shrink-0">
          <TabsList className="h-10 bg-transparent gap-0 p-0 flex-shrink-0">
            {tabs.map((tab) => (
              <div key={tab.id} className="flex items-center">
                <TabsTrigger
                  value={tab.id}
                  className="relative h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 text-xs max-w-[140px]"
                >
                  <Bot className="h-3 w-3 mr-1.5 flex-shrink-0" />
                  <span className="truncate max-w-[80px]">{tab.label}</span>
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0 ml-1"
            onClick={addTab}
            title="New chat tab"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Tab Contents */}
        {tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=inactive]:hidden"
          >
            {/* Agent ID Input */}
            <div className="px-3 py-2 border-b bg-muted/30 flex-shrink-0">
              <div className="flex items-center gap-2 max-w-xl">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Agent:</span>
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="Agent ID (leave empty for default)"
                  value={tab.agentId}
                  onChange={(e) =>
                    updateTab(tab.id, (t) => ({
                      ...t,
                      agentId: e.target.value,
                      label: e.target.value ? e.target.value.slice(0, 12) : t.label,
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => clearMessages(tab.id)}
                  title="Clear conversation"
                  disabled={tab.messages.length === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-3 md:px-6 py-4">
              {tab.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Bot className="h-10 w-10 mb-3 opacity-40" />
                  <p className="text-sm">Start a conversation</p>
                  <p className="text-xs mt-1 opacity-60">You can also attach images or files</p>
                </div>
              ) : (
                <div className="space-y-4 max-w-3xl mx-auto">
                  {tab.messages.map((msg) => (
                    <div key={msg.id}>
                      {/* Show attachment preview for user messages */}
                      {msg.role === 'user' && msg.attachment && (
                        <div className="flex justify-end mb-1">
                          {msg.attachment.type === 'image' && msg.attachment.preview ? (
                            <div className="rounded-lg overflow-hidden border max-w-[200px]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.attachment.preview}
                                alt={msg.attachment.name}
                                className="max-w-full max-h-[150px] object-contain"
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
                      <ChatMessage message={msg} />
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Pending file preview */}
            {tab.pendingFile && (
              <div className="border-t px-3 py-2 bg-muted/30 flex-shrink-0">
                <div className="flex items-center gap-2 max-w-3xl mx-auto">
                  {tab.pendingFilePreview ? (
                    <div className="relative flex items-center gap-2">
                      <div className="rounded border overflow-hidden w-12 h-12 flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={tab.pendingFilePreview}
                          alt={tab.pendingFile.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium truncate">{tab.pendingFile.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {(tab.pendingFile.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium truncate">{tab.pendingFile.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {(tab.pendingFile.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-auto flex-shrink-0"
                    onClick={() => clearPendingFile(tab.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="border-t p-3 bg-card flex-shrink-0">
              <form
                className="flex gap-2 max-w-3xl mx-auto items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage(tab.id);
                }}
              >
                {/* Paperclip / file attach button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 flex-shrink-0"
                  disabled={tab.streaming}
                  onClick={() => fileInputRef.current?.click()}
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
                  className="flex-1"
                  placeholder={tab.pendingFile ? 'Add a message (optional)...' : 'Type a message...'}
                  value={tab.input}
                  onChange={(e) =>
                    updateTab(tab.id, (t) => ({ ...t, input: e.target.value }))
                  }
                  disabled={tab.streaming}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(tab.id);
                    }
                  }}
                />
                <Button
                  type="submit"
                  size="icon"
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
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
