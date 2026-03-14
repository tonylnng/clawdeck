# ClawDeck — Project Overview

ClawDeck is an OpenClaw admin dashboard providing a web UI for managing agents, sessions, chat, logs, memory, workspace, analytics, and more.

## Current Version: v1.5.3

## Changelog

### v1.5.3 (2026-03-14) — Bug Fixes & Stability
- **Fix:** React #300 hooks order violation — `useCallback` hooks moved before conditional return in `SinglePanel`
- **Fix:** `sessions_send` tool doesn't exist in gateway — Channel send now routes via `/v1/chat/completions`
- **Fix:** Channel send reply displayed in chat after successful send
- **Fix:** Sessions dropdown position (`absolute right-0`) — no longer jumps off-screen
- **Fix:** `redactMiddleware` was redacting `key` field (session keys) — removed `key` from sensitive list
- **Fix:** `sessions_history` parse — gateway returns `result.content[0].text` as JSON string, now correctly parsed
- **Fix:** Group chat agent ID normalization — `main` → `agent:main:main`
- **Fix:** `groupStarted` always reset on page load (prevents stale localStorage crash)
- **New:** React Error Boundary with Reset & Reload button
- **New:** React Suspense wrapper for `useSearchParams` hook
- **New:** Group chat per-agent typing indicator (thinking bubble before reply)
- **New:** Group chat timeout increased from 30s → 60s
- **New:** Channel session history loading spinner
- **New:** Gateway calls have 15s timeout (prevents indefinite hang)
- **New:** Empty-content messages (toolCalls) filtered from channel history

### v1.5.0 (2026-03-14) — Multi-Agent Group Chat
- **New:** Group Chat mode in the Chat page (Agent | Channel | **Group** toggle)
- **New:** Backend `/api/groupchat/send` SSE endpoint — orchestrates sequential agent calls
- **New:** Each agent sees all previous agents' replies in context (true orchestration)
- **New:** Color-coded agent avatars (6 fixed colors: purple, green, orange, pink, cyan, yellow)
- **New:** Auto Round mode — agents automatically continue discussion after user message
- **New:** 2–6 agent support per group session
- **New:** Group session state persisted in localStorage
- See: [CLAWDECK-CHAT-V150.md](./CLAWDECK-CHAT-V150.md)

### v1.4.0 — Channel Mode Enhancements
- Session polling and live channel monitoring
- Session browser with Load dropdown
- Channel source badge on messages
- See: [CLAWDECK-CHAT-V140.md](./CLAWDECK-CHAT-V140.md)

### v1.3.0 — Chat Improvements
- Pinned messages
- Quick commands (`/clear`, `/agent`, `/new`, `/help`)
- Split view (up to 8 panels)
- File/image attachments
- See: [CLAWDECK-CHAT-V130.md](./CLAWDECK-CHAT-V130.md)

### v1.2.0 — Multi-Tab Chat
- Tab-based chat interface
- Per-tab agent selection
- LocalStorage persistence
- See: [CLAWDECK-CHAT-V120.md](./CLAWDECK-CHAT-V120.md)
