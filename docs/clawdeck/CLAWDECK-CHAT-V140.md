# ClawDeck Chat v1.4.0 — Channel Sync

> Released: 2026-03-14  
> Version: v1.4.0 (upgraded from v1.3.0)

---

## Overview

ClawDeck Chat now supports **Channel Sync** — direct bidirectional connection to any OpenClaw channel session (Telegram, WhatsApp, Discord, etc.). Chat tabs can operate in two modes:

| Mode | Description |
|------|-------------|
| **Agent** | Standard chat completions via AI agent (original behaviour) |
| **Channel** | Live sync with an OpenClaw session — reads history + sends messages + polls for new messages every 5s |

Up to **8 panels** can be displayed simultaneously in Split View, each independently connecting to different channels.

---

## Architecture

```
ClawDeck Frontend
    │
    │  HTTP /api/sessions/*
    ▼
ClawDeck Backend (Express)
    │
    │  Gateway Tool Invocation (POST /tools/invoke)
    ▼
OpenClaw Gateway
    │
    ├── sessions_list   → list all active sessions
    ├── sessions_history → read conversation history
    └── sessions_send   → send a message into a session
```

### New Backend Routes (`/api/sessions`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all active sessions from gateway |
| `GET` | `/api/sessions/:key/history?limit=50` | Load last N messages for a session |
| `POST` | `/api/sessions/:key/send` | Send a message into a session |
| `GET` | `/api/sessions/:key/poll?since=<ISO timestamp>` | Poll for messages newer than timestamp |

All routes require authentication (existing `requireAuth` middleware).

### New Backend File

- `/home/tonic/clawdeck/backend/src/routes/sessions.ts`

Registered in `index.ts`:
```typescript
import sessionsRouter from './routes/sessions';
app.use('/api/sessions', sessionsRouter);
```

---

## Session Key Format

OpenClaw session keys follow this pattern:

```
agent:<agentId>:<channel>:<sessionSuffix...>
```

Examples:
- `agent:main:telegram:abc123` — Telegram session for the "main" agent
- `agent:main:whatsapp:+85290000000` — WhatsApp session
- `agent:tonic-ai-tech:main.main` — Main session (internal)

The channel segment (index 2) is used to:
1. Display the channel badge (e.g. `[telegram]`, `[whatsapp]`)
2. Apply colour coding in the UI

---

## Polling Mechanism

When a Channel tab connects to a session:

1. **History load**: Fetches last 50 messages from `/api/sessions/:key/history`
2. **Polling starts**: Every 5 seconds, polls `/api/sessions/:key/poll?since=<lastTimestamp>`
3. **Deduplication**: New messages are filtered by ID — already-present messages are skipped
4. **Append**: New messages are appended to the tab's message list
5. **Cleanup**: Polling timer is cleared when the tab closes or mode switches back to Agent

```
Poll cycle (5s interval):
┌─────────────────────────────────────────────┐
│ GET /api/sessions/:key/poll?since=<ts>      │
│                                             │
│ Backend calls sessions_history via gateway  │
│ Filters messages where timestamp > since    │
│ Returns new messages                        │
│                                             │
│ Frontend deduplicates by message ID         │
│ Appends new messages to tab                 │
│ Updates lastPollTimestamp                   │
└─────────────────────────────────────────────┘
```

---

## How to Connect a Telegram Session

### Step 1: Open Chat → Switch to Channel Mode

In any chat tab, click the **Channel** toggle button in the header bar (next to Agent).

### Step 2: Browse Available Sessions

Click **"Load ▾"** to fetch and display all available OpenClaw sessions. A dropdown will appear listing sessions grouped by agent and channel.

### Step 3: Select Your Telegram Session

Find the session labeled `main / telegram` (or similar). Click it to:
- Set the session key automatically
- Load the last 50 messages of conversation history
- Start live polling

### Step 4: Send Messages

Type in the input box and press Enter (or click Send). The message is sent via the OpenClaw Gateway into the Telegram session. The user on Telegram will receive it as if the agent sent it.

Incoming replies from Telegram users appear automatically within 5 seconds via polling.

---

## UI Features

### Channel Badge
Each message from a channel session displays a coloured source badge:
- 🔵 **Telegram** — blue
- 🟢 **WhatsApp** — green  
- 🟣 **Discord** — indigo
- 🟣 **Slack** — purple

### Live Indicator
Active channel tabs show a pulsing blue dot (●) indicating the polling connection is live.

### Tab Icons
- 🤖 Bot icon = Agent mode tab
- 📡 Radio icon = Channel mode tab

### Split View
Up to 8 channel or agent tabs can be displayed side-by-side. Use the split view toggle (⊞) in the top-right of the chat toolbar.

---

## Message Normalisation

The backend normalises gateway session history into a consistent format:

```typescript
interface NormalizedMessage {
  id: string;           // message ID (generated if missing)
  role: 'user' | 'assistant';
  content: string;      // extracted from string, object, or text field
  timestamp: string;    // ISO 8601 string
  source?: string;      // channel name derived from session key
}
```

Supports various gateway response shapes:
- `{ messages: [...] }`
- `{ history: [...] }`
- Direct array `[...]`

---

## Files Changed in v1.4.0

| File | Change |
|------|--------|
| `backend/src/routes/sessions.ts` | **New** — session list, history, send, poll routes |
| `backend/src/index.ts` | Register sessions router |
| `frontend/src/app/dashboard/chat/page.tsx` | Add Channel mode to ChatTab, polling, sessions dropdown |
| `frontend/src/app/dashboard/layout.tsx` | Version → v1.4.0 |
| `frontend/src/components/layout/Footer.tsx` | Version → v1.4.0 |
| `frontend/package.json` | Version → 1.4.0 |
| `backend/package.json` | Version → 1.4.0 |
