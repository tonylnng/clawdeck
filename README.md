# ClawDeck

**ClawDeck** is an open-source web dashboard for managing [OpenClaw](https://openclaw.ai) multi-agent setups. Control your agents, monitor logs, browse workspaces, and explore agent memory — all from a clean, responsive UI.

![ClawDeck Logo](./frontend/public/logo.png)

---

## Features

- 🤖 **Agent Overview** — See all your OpenClaw agents and their status at a glance
- 💬 **Multi-Agent Chat** — Chat with multiple agents simultaneously in tabs, with real-time SSE streaming
- 📎 **File & Image Upload** — Send images and documents directly to agents
- 📋 **Log Viewer** — Real-time Gateway and per-Agent log streaming with color-coded levels
- 📁 **Workspace Browser** — Browse, view, and edit agent workspace files with Markdown rendering
- 🧠 **Memory Browser** — Search, view, and delete agent memories (LanceDB)
- 🔐 **Secure by Default** — JWT auth, API key auto-redaction, file blacklist protection
- 🌓 **Dark / Light Mode** — Follows system preference, manually toggleable
- 📱 **Mobile Responsive** — Works on phones and tablets
- 🐳 **Docker Compose** — One-command deployment

---

## Prerequisites

### 1. OpenClaw with HTTP endpoints enabled

Add to your `~/.openclaw/openclaw.json`:

```json5
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true },
        "responses": { "enabled": true }
      }
    }
  }
}
```

Then restart OpenClaw gateway:
```bash
systemctl --user restart openclaw-gateway
```

### 2. Docker & Docker Compose

```bash
sudo apt install docker.io docker-compose-v2
sudo usermod -aG docker $USER
newgrp docker
```

---

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/clawdeck.git
cd clawdeck
cp .env.example .env
```

Edit `.env` with your settings:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourpassword        # plain password (dev) or use ADMIN_PASSWORD_HASH
JWT_SECRET=your-32-char-secret     # generate: openssl rand -hex 32
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token   # from openclaw.json gateway.auth.token
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

Then start:

```bash
docker compose up -d --build
```

Open `http://localhost:3000` and sign in.

---

## Remote Access (Tailscale)

ClawDeck works great over [Tailscale](https://tailscale.com). Bind to your Tailscale IP in `.env`:

```env
NEXT_PUBLIC_BACKEND_URL=http://100.x.x.x:3001
```

And update `docker-compose.yml` ports to include your Tailscale IP.

---

## Agent Workspaces

Default paths (configurable via env vars):

| Agent | Path |
|-------|------|
| `main` | `~/.openclaw/workspace` |
| `tonic-ai-tech` | `~/.openclaw/workspace-tonic-ai-tech` |
| `tonic-ai-workflow` | `~/.openclaw/workspace-tonic-ai-workflow` |

Override with `WORKSPACE_MAIN`, `WORKSPACE_TONIC_AI_TECH`, `WORKSPACE_TONIC_AI_WORKFLOW` env vars.

---

## Security

- All API keys auto-redacted in logs and responses (`sk-`, `tvly-`, `jina_`, `ntn_`, etc.)
- Sensitive files blocked from read/write (`auth-profiles.json`, `.env`, `openclaw.json`, `*.key`, `*.pem`)
- JWT HttpOnly cookies
- Keep ClawDeck on localhost or a private network (Tailscale recommended)

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Express.js + TypeScript |
| Real-time | SSE (Server-Sent Events) |
| Deployment | Docker Compose |

---

## License

MIT
