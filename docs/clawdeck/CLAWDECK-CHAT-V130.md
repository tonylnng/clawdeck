# ClawDeck Chat v1.3.0 — New Features

Released: 2026-03-14

## Overview

ClawDeck v1.3.0 adds four quality-of-life enhancements to the Chat page, improving accessibility, workflow efficiency, and message organization.

---

## Feature 1: TTS Playback Button

**File:** `frontend/src/components/chat/ChatMessage.tsx`

### Description
Every assistant message now has a speaker button that reads the message aloud using the browser's built-in Web Speech API.

### Behaviour
- Appears on hover in the action row below the message bubble (alongside Copy and Pin)
- Icon: `Volume2` (lucide-react) when idle, `VolumeX` when speaking
- Click to start reading → label changes to "Stop" with orange icon
- Click again to stop (`window.speechSynthesis.cancel()`)
- Auto-resets when speech finishes naturally

### Implementation Notes
- Pure frontend — no backend API required
- Uses `window.speechSynthesis` and `SpeechSynthesisUtterance`
- `utterance.onend` and `utterance.onerror` both reset speaking state
- Only visible on assistant messages (not user messages)

---

## Feature 2: Quick Commands (`/` trigger)

**File:** `frontend/src/app/dashboard/chat/page.tsx`

### Description
Typing `/` in the chat input triggers a floating command palette showing available slash commands.

### Built-in Commands
| Command | Description |
|---------|-------------|
| `/clear` | Clear the current conversation |
| `/agent <id>` | Switch the agent ID for this chat tab |
| `/new` | Open a new chat tab |
| `/help` | Display all commands as a system message in chat |

### Behaviour
- Dropdown appears immediately on `/` keystroke, positioned above the input bar
- Filtered in real-time as you type more characters
- Keyboard navigation: `↑` / `↓` to move selection, `Enter` to execute, `Escape` to close
- Commands that require confirmation (`/agent`) fill the input for you to complete; commands with no args (`/clear`, `/new`, `/help`) execute immediately
- `z-index: 50` ensures the dropdown floats above the scroll area

### Implementation Notes
- `QUICK_COMMANDS` array is defined at module level for easy extension
- `showCommands` state is reset on blur with 150ms delay to allow click events on dropdown items
- `/help` injects a synthetic assistant message into the chat

---

## Feature 3: Pinned Messages

**File:** `frontend/src/app/dashboard/chat/page.tsx` + `ChatMessage.tsx`

### Description
Any message (user or assistant) can be pinned to a collapsible "Pinned" section at the top of the chat. Pin state persists in localStorage.

### Behaviour
- **Pinning:** Hover any message → "📌 Pin" button appears in the action row → click to pin
- **Unpin:** Hover pinned message → button shows "Unpin" (amber color); click to remove pin
- **Pinned section:** Displayed between the Agent header and the message list; shows role emoji (👤/🤖) + first 50 characters of content
- **Collapse:** Click the "Pinned (n)" header to collapse/expand the section
- **Scroll to:** Click any pinned message summary to scroll to the original message and briefly highlight it with an amber ring
- **Persistence:** `pinned` field added to `Message` interface and `PersistedMessage` interface; saved alongside existing tab data in `clawdeck-chat-tabs` localStorage key

### Schema Change
```typescript
interface Message {
  // ... existing fields ...
  pinned?: boolean;  // NEW in v1.3.0
}
```

### Implementation Notes
- `PinnedSection` is a self-contained component that reads `messages.filter(m => m.pinned)`
- Scrolling uses `messageRefs` (a `Map<string, HTMLDivElement>`) maintained via `ref` callbacks on each message wrapper
- Highlight effect: temporary `ring-2 ring-amber-400` Tailwind classes removed after 2000ms

---

## Feature 4: Session Rename (Inline Tab Label Edit)

**File:** `frontend/src/app/dashboard/chat/page.tsx`

### Description
Tab labels can be renamed by double-clicking them — both in tab mode and split view.

### Behaviour
- **Trigger:** Double-click the tab label text
- **Editing:** Label transforms into an inline `<input>` pre-filled with current name
- **Confirm:** Press `Enter` or click away (blur) to save
- **Cancel:** Press `Escape` to discard changes
- Auto-naming on first message still works as before; manual rename simply overwrites `tab.label`

### Implementation Notes
- `InlineTabLabel` is a reusable component wrapping the label text
- Input has `bg-transparent border-b border-primary` styling to blend with the tab bar
- `e.stopPropagation()` prevents the double-click from bubbling to the `TabsTrigger` (which would switch tabs)
- `renameTab(tabId, newLabel)` calls `updateTab` to update `label` in state → triggers debounced localStorage save

---

## Files Changed

| File | Changes |
|------|---------|
| `frontend/src/components/chat/ChatMessage.tsx` | TTS button, Pin button, updated `Message` interface |
| `frontend/src/app/dashboard/chat/page.tsx` | Quick commands, Pinned messages section, Session rename, `onAddTab` prop threading |
| `frontend/src/app/dashboard/layout.tsx` | Version bump to v1.3.0 |
| `frontend/src/components/layout/Footer.tsx` | Version bump to v1.3.0 |
| `frontend/package.json` | Version 1.2.0 → 1.3.0 |
| `backend/package.json` | Version 1.2.0 → 1.3.0 |
