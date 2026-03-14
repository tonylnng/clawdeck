# ClawDeck — Project Overview

ClawDeck is an OpenClaw admin dashboard providing a web UI for managing agents, sessions, chat, logs, memory, workspace, analytics, and more.

## Changelog

### v1.5.0 (March 2026) — Multi-Agent Group Chat
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
