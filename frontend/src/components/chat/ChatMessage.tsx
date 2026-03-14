'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { useTheme } from 'next-themes';
import { Bot, User, Copy, Check, Volume2, VolumeX, Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  pinned?: boolean;
}

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  onPin?: (messageId: string) => void;
}

// Animated typing indicator (three bouncing dots)
function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span
        className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '0ms', animationDuration: '900ms' }}
      />
      <span
        className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '150ms', animationDuration: '900ms' }}
      />
      <span
        className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '300ms', animationDuration: '900ms' }}
      />
    </span>
  );
}

export function ChatMessage({ message, isStreaming = false, onPin }: ChatMessageProps) {
  const { resolvedTheme } = useTheme();
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleTTS = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      const utterance = new SpeechSynthesisUtterance(message.content);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      setIsSpeaking(true);
    }
  };

  const handlePin = () => {
    onPin?.(message.id);
  };

  // Show typing indicator when streaming and no content yet
  const showTypingIndicator = !isUser && isStreaming && !message.content;

  return (
    <div className={cn('group flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground border border-border'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Bubble + action buttons */}
      <div className={cn('flex flex-col gap-1 max-w-[85%]', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm shadow-sm',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-muted/80 rounded-tl-sm border border-border/50'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : showTypingIndicator ? (
            <TypingIndicator />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const isBlock = match !== null;

                    if (isBlock) {
                      return (
                        <SyntaxHighlighter
                          style={resolvedTheme === 'dark' ? oneDark : oneLight}
                          language={match[1]}
                          PreTag="div"
                          className="rounded-md text-xs !my-2"
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      );
                    }

                    return (
                      <code
                        className="bg-background/50 rounded px-1 py-0.5 text-xs font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  pre({ children }) {
                    return <>{children}</>;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Timestamp */}
          {!showTypingIndicator && (
            <p
              className={cn(
                'text-[10px] mt-1',
                isUser ? 'text-primary-foreground/60 text-right' : 'text-muted-foreground'
              )}
            >
              {message.timestamp instanceof Date
                ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        {/* Action buttons — shown on hover */}
        {message.content && (
          <div className={cn(
            'opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 px-1',
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}>
            {/* Copy button (assistant only) */}
            {!isUser && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                title="Copy message"
              >
                {copied ? (
                  <><Check className="h-3 w-3 text-green-500" /><span className="text-green-500">Copied</span></>
                ) : (
                  <><Copy className="h-3 w-3" /><span>Copy</span></>
                )}
              </button>
            )}

            {/* TTS button (assistant only) */}
            {!isUser && !showTypingIndicator && (
              <button
                onClick={handleTTS}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
              >
                {isSpeaking ? (
                  <><VolumeX className="h-3 w-3 text-orange-500" /><span className="text-orange-500">Stop</span></>
                ) : (
                  <><Volume2 className="h-3 w-3" /><span>Read</span></>
                )}
              </button>
            )}

            {/* Pin button (all messages) */}
            {onPin && (
              <button
                onClick={handlePin}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                title={message.pinned ? 'Unpin message' : 'Pin message'}
              >
                {message.pinned ? (
                  <><PinOff className="h-3 w-3 text-amber-500" /><span className="text-amber-500">Unpin</span></>
                ) : (
                  <><Pin className="h-3 w-3" /><span>Pin</span></>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
