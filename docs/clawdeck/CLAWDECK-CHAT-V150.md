# ClawDeck Chat v1.5.0 — Multi-Agent Group Chat

## Overview

ClawDeck v1.5.0 introduces true multi-agent group chat orchestration. Users can assemble 2–6 agents into a group session where each agent responds in sequence, with full visibility into previous agents' replies — simulating a real group discussion.

---

## Architecture

```
User message
    ↓
[ClawDeck Orchestrator — /api/groupchat/send]
    ↓ system: "You are AgentA. Other participants: AgentB, AgentC."
    │ messages: [history... , user_msg]
Agent A → reply A
    ↓ system: "You are AgentB. Other participants: AgentA, AgentC."
    │ messages: [history..., user_msg, [AgentA]: reply A]
Agent B → reply B
    ↓ system: "You are AgentC. Other participants: AgentA, AgentB."
    │ messages: [history..., user_msg, [AgentA]: reply A, [AgentB]: reply B]
Agent C → reply C
    ↓
SSE stream: each reply arrives as it completes
    ↓
Frontend displays each agent's reply with color-coded avatar
```

---

## Orchestration Mechanism

### Backend (`/api/groupchat/send`)

**Endpoint:** `POST /api/groupchat/send`

**Request Body:**
```json
{
  "agents": ["main", "tonic-ai-tech", "third-agent"],
  "message": "What do you think about this idea?",
  "history": [
    { "role": "user", "content": "Hello everyone" },
    { "role": "assistant", "content": "Hi!", "agentId": "main" }
  ],
  "model": "default"
}
```

**Validation:**
- `agents`: 2–6 agents required
- `message`: non-empty string required

**Sequential Processing:**
1. For each agent in order:
   - Build system prompt: `"You are {agentId} participating in a group discussion. Other participants: {others}. Respond naturally as your character. Keep responses concise (2-3 sentences max)."`
   - Build messages array: `[system, ...history, user_msg, ...prior_agent_replies]`
   - Call gateway `/v1/chat/completions` with `stream: false`
   - Parse `choices[0].message.content`
   - Append reply to running context for next agent
   - Stream SSE event immediately

**SSE Event Format:**
```
data: {"agentId": "main", "content": "Here's my take...", "done": false}

data: {"agentId": "tonic-ai-tech", "content": "I agree, and additionally...", "done": false}

data: {"done": true}
```

**Timeout:** 30 seconds per agent (AbortController)

---

## Agent Color Scheme

Six fixed colors assigned by agent position index (0–5):

| Index | Color  | Avatar bg     | Label color        |
|-------|--------|---------------|--------------------|
| 0     | purple | `bg-purple-500` | `text-purple-600` |
| 1     | green  | `bg-green-500`  | `text-green-600`  |
| 2     | orange | `bg-orange-500` | `text-orange-600` |
| 3     | pink   | `bg-pink-500`   | `text-pink-600`   |
| 4     | cyan   | `bg-cyan-500`   | `text-cyan-600`   |
| 5     | yellow | `bg-yellow-500` | `text-yellow-700` |

Each agent bubble uses a matching light background with colored border and avatar initials.

---

## Frontend — Group Chat UI

### Mode Toggle

The chat header now has **three mode buttons**: `Agent` | `Channel` | `Group`

### Group Setup Screen

Before starting a group chat, users see:
- Agent chip input (add agent by ID, press Enter or click Add)
- Agent chips with ✕ to remove
- Minimum 2, maximum 6 agents enforced
- **Auto Round** toggle
- **Start Group Chat** button (disabled until ≥2 agents)

### Active Group Chat

- **Header:** Color-coded agent badges + Auto Round indicator + Clear/Reset buttons
- **Messages:** 
  - User messages: right-aligned blue bubble (same as agent mode)
  - Agent messages: left-aligned with colored avatar (initials), agent ID label, colored bubble
- **Input:** Standard message input → triggers sequential agent responses

### ChatTab Interface Extensions

```typescript
interface ChatTab {
  // ... existing fields ...
  mode: 'agent' | 'channel' | 'group';  // added 'group'
  groupAgents?: string[];                 // ordered agent list
  groupStarted?: boolean;                 // setup vs active state
  autoRound?: boolean;                    // auto second round
}

interface Message {
  // ... existing fields ...
  agentId?: string;   // which agent sent this (group mode)
  color?: string;     // agent color key (group mode)
}
```

---

## Auto Round Feature

When **Auto Round** is enabled:

1. User sends a message → agents respond in order (Round 1)
2. After Round 1 completes, ClawDeck automatically injects `[Continue the discussion]` as the next prompt
3. All agents respond again (Round 2), seeing Round 1's full conversation as context
4. Simulates a natural group discussion where agents bounce ideas off each other

**Use case:** Brainstorming sessions, multi-perspective analysis, simulated debates

---

## Tab Integration

- Group tabs show a 👥 purple icon in the tab bar and header
- Tab label auto-sets from first user message
- Group configuration persisted to localStorage (agents, autoRound setting)
- Works in both tab mode and split view

---

## Version

- v1.5.0 (March 2026)
- Introduced: Multi-Agent Group Chat with orchestration layer
