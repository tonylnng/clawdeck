# ClawDeck Chat v1.2.0

Release: 2026-03-14  
Version: `v1.2.0` (upgraded from `v1.1.1`)

---

## Features

### 1. UI Polish (Chat Page)

#### Message Bubbles
- **User messages**: Right-aligned blue bubble (`bg-primary text-primary-foreground`), rounded with `rounded-tr-sm` tail
- **Assistant messages**: Left-aligned muted bubble (`bg-muted/80`) with border, `rounded-tl-sm` tail
- Both have avatar icons and subtle `shadow-sm`

#### Animated Typing Indicator
- When streaming starts and the assistant message content is still empty, a **three-dot bounce animation** is shown inside the assistant bubble instead of a cursor character (`▋`)
- Implemented as `<TypingIndicator />` in `ChatMessage.tsx`:
  - Three circles with `animate-bounce` and staggered `animationDelay` (0ms, 150ms, 300ms)
  - Disappears automatically once content begins arriving
- `isStreaming` prop passed from parent to `ChatMessage` component to detect the typing state

#### Session Auto-Naming
- When a user sends their **first message** in a tab, the tab label is automatically set to the first 20 characters of that message (with `…` if truncated)
- If the message starts empty (file-only), the label stays as-is
- Label is updated via `autoLabel()` helper in `page.tsx`

#### Chat Header (Tab Mode)
- Each tab content panel shows a clean header:
  - Bot icon + **session name** (bold)
  - Agent ID displayed in small monospace text below (if set)
  - Live "Streaming" badge (green pulse dot) when response is in progress

---

### 2. Conversation Persistence (localStorage)

#### How It Works
- Conversations are saved to `localStorage` under key `clawdeck-chat-tabs`
- Active tab ID is saved under key `clawdeck-chat-active`
- On page load, the saved state is restored automatically (tabs + messages)
- `Message.timestamp` is stored as ISO string and restored as `new Date(timestamp)`

#### LocalStorage Schema

```ts
// Key: "clawdeck-chat-tabs"
// Value: JSON.stringify(PersistedTab[])

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;         // ISO 8601 date string
  attachment?: {
    type: 'image' | 'file';
    name: string;
    preview?: string;        // data URL (images only)
  };
}

interface PersistedTab {
  id: string;
  agentId: string;
  label: string;
  messages: PersistedMessage[];
}

// Key: "clawdeck-chat-active"
// Value: string (tab id)
```

#### Limits
| Constraint | Value |
|---|---|
| Max tabs saved | 20 |
| Max messages per tab | 100 (last 100 kept) |
| Debounce delay | 500ms (avoids excessive writes) |

#### Clear
- The **Clear conversation** button (trash icon in the agent header) clears both the in-memory messages array and triggers an immediate localStorage save

---

### 3. Split View (Up to 8 Panels)

#### Toggle
- A **LayoutTemplate** icon button sits next to the `+` tab button in the tab bar
- Clicking it toggles between **tab mode** and **split view**
- In split view the icon switches to **Rows3** (indicating "return to tabs")

#### Grid Layout Rules

| Panel count | Grid columns | CSS class |
|---|---|---|
| 1 | 1 | `grid-cols-1` |
| 2 | 2 | `grid-cols-2` |
| 3 – 4 | 2 | `grid-cols-2` |
| 5 – 6 | 3 | `grid-cols-3` |
| 7 – 8 | 4 | `grid-cols-4` |

- Rows fill naturally based on panel count (CSS Grid auto-rows)
- Panels are separated by a 1px `bg-border` gap

#### Panel Independence
- Each panel in split view is a fully independent `<SinglePanel>` component
- Has its own: scrollable message list, agent ID input, input field, send button, file attach
- Panels do **not** share state — each tab operates independently
- Max 8 panels in split view (`MAX_SPLIT_PANELS = 8`); the `+` button is disabled at the limit

#### Tab Bar in Split View
- Instead of clickable tabs, the tab bar shows compact **pill labels** for all active panels
- Each pill shows the session label, agent ID, streaming indicator, and a close (×) button

---

## File Map

| File | Change |
|---|---|
| `frontend/src/app/dashboard/chat/page.tsx` | Full rewrite — all three features |
| `frontend/src/components/chat/ChatMessage.tsx` | Added `isStreaming` prop + `TypingIndicator` component |
| `frontend/src/app/dashboard/layout.tsx` | Version bump `v1.1.1` → `v1.2.0` |
| `frontend/src/components/layout/Footer.tsx` | Version bump `v1.1.1` → `v1.2.0` |
| `frontend/package.json` | Version `1.1.1` → `1.2.0` |
| `backend/package.json` | Version `1.1.1` → `1.2.0` |

---

## Architecture Notes

- `SinglePanel` is a new internal component that encapsulates per-tab UI (messages + input)
- Used in both tab mode (inside `<TabsContent>`) and split view (inside a CSS Grid)
- `saveTabs()` / `loadTabs()` handle serialization/deserialization with Date restoration
- `scheduleSave()` uses a 500ms debounce timer stored in `saveTimerRef`
