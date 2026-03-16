# ClawDeck

**ClawDeck** is an open-source web dashboard for managing [OpenClaw](https://openclaw.ai) multi-agent setups. Control your agents, monitor logs, browse workspaces, and explore agent memory — all from a clean, responsive UI.

<img src="./frontend/public/logo.png" alt="ClawDeck Logo" width="80" />

---

## Features

- 🤖 **Agent Overview** — See all your OpenClaw agents, health details, and switch models on the fly
- 💬 **Multi-Agent Chat** — Chat with multiple agents simultaneously in tabs, with real-time SSE streaming
- 📎 **File & Image Upload** — Send images and documents directly to agents
- 📋 **Log Viewer** — Real-time Gateway and per-Agent log streaming with color-coded levels
- 📁 **Workspace Browser** — Browse, view, and edit agent workspace files with Markdown rendering
- 🧠 **Memory Browser** — Search, view, and delete agent memories (LanceDB)
- 📊 **Analytics Dashboard** — Token usage, session stats, and model distribution per agent
- 🔑 **Auth Profile Editor** — View redacted API keys, check cooldown status, and reset rate-limit cooldowns via GUI
- 🔍 **Conversation Search** — Search across all agent sessions with export to Markdown
- 🧪 **Prompt Playground** — Test prompts against any agent/model without opening a full chat session
- ⏰ **Cron Job Manager** — View, add, edit, enable/disable, and delete OpenClaw cron jobs via GUI
- 🔐 **Secure by Default** — JWT auth, API key auto-redaction, file blacklist protection
- 🌓 **Dark / Light Mode** — Follows system preference, manually toggleable
- 📱 **Mobile Responsive** — Works on phones and tablets
- ⚙️ **Setup Wizard** — Visual config checker that guides you through any missing settings
- 🐳 **One-command Install** — Interactive `install.sh` auto-detects your OpenClaw setup

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

### Quick Install (Recommended)

ClawDeck ships with an interactive installer that auto-detects your OpenClaw setup — no manual config needed.

```bash
git clone https://github.com/tonylnng/clawdeck.git
cd clawdeck
bash install.sh
```

The installer will:

1. **Auto-detect** your `~/.openclaw/openclaw.json` → reads gateway port & token automatically
2. **Scan** `~/.openclaw/agents/` → discovers all your agents and workspace paths
3. **Ask** for admin username/password
4. **Generate** `.env` and `docker-compose.yml` tailored to your setup (network mode auto-configured)
5. **Build & start** ClawDeck with `docker compose up -d --build`

Then open **http://localhost:3000** and sign in.

---

### Manual Installation

If you prefer to configure manually:

```bash
git clone https://github.com/tonylnng/clawdeck.git
cd clawdeck
cp .env.example .env
```

Edit `.env`:

```env
# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourpassword           # dev fallback (plain)
ADMIN_PASSWORD_HASH=                  # recommended: bcrypt hash (see below)
JWT_SECRET=                           # generate: openssl rand -hex 32
JWT_EXPIRES_IN=24h

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=               # from ~/.openclaw/openclaw.json → gateway.token

# Agents (comma-separated)
CLAWDECK_AGENTS=main,my-second-agent

# Workspace paths — one env var per agent
# Naming: WORKSPACE_<AGENT_ID uppercased, hyphens → underscores>
WORKSPACE_MAIN=/home/youruser/.openclaw/workspace
WORKSPACE_MY_SECOND_AGENT=/home/youruser/.openclaw/workspace-my-second-agent

# Ports & URLs
BACKEND_PORT=3001
FRONTEND_PORT=3000
NODE_ENV=production
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

<details>
<summary>Generate a bcrypt password hash</summary>

```bash
cd clawdeck/backend
npm install           # if not already done
node -e "const b=require('bcryptjs'); b.hash('yourpassword',10).then(console.log)"
```

</details>

Then start:

```bash
docker compose up -d --build
```

Open **http://localhost:3000** and sign in.

---

## Setup & Status Page

After logging in, go to **⚙️ Setup** in the sidebar to verify your configuration:

- ✅ Gateway URL configured
- ✅ Gateway reachable
- ✅ Agents detected
- ✅ Workspace paths resolved

If anything is missing, the page shows exactly what to fix.

---

## Adding More Agents

To add a new agent after install, edit `.env`:

```env
CLAWDECK_AGENTS=main,my-new-agent
WORKSPACE_MY_NEW_AGENT=/home/youruser/.openclaw/workspace-my-new-agent
```

Add the workspace volume to `docker-compose.yml`:

```yaml
volumes:
  - /home/youruser/.openclaw/workspace-my-new-agent:/home/youruser/.openclaw/workspace-my-new-agent:rw
```

Then restart:

```bash
docker compose up -d --build
```

---

## Federation — Multi-Machine Setup

ClawDeck can manage and orchestrate agents running on **separate machines** through its Instance Manager (`g+f`). You can also run **Cross-Instance Group Chat** with agents from different machines in a single conversation.

### Quick Setup (Remote Machine)

Run this on each remote machine you want to add to ClawDeck:

```bash
bash federation-setup.sh
```

This script automatically:
- Checks OpenClaw and Tailscale are installed and connected
- Updates `openclaw.json` with the required settings (backs up first)
- Opens the gateway port in UFW for the Tailscale network only
- Restarts the gateway and prints the URL + token to paste into ClawDeck

### What the script configures

Each remote OpenClaw instance needs three things in `~/.openclaw/openclaw.json`:

```json5
{
  "gateway": {
    "bind": "tailnet",           // listen on Tailscale interface
    "tailscale": {
      "mode": "off"              // bind=tailnet works without serve/funnel
    },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true },
        "responses": { "enabled": true }
      }
    }
  }
}
```

After updating, restart the gateway:
```bash
openclaw gateway restart
```

### Add the instance in ClawDeck

1. Open ClawDeck → **Instances** (`g+f`) → **Add Instance**
2. Enter the URL shown by the setup script: `http://<tailscale-ip>:<port>`
3. Paste the gateway token from `~/.openclaw/openclaw.json → gateway.auth.token`
4. Click **Test Connection** — you should see a green latency badge
5. Save

### Cross-Instance Group Chat

Once instances are added, open **Chat** → create a **Group** tab:
- Select **Instance** for each agent slot (Local or any added instance)
- Enter the Agent ID (e.g. `main`, `tonic-ai-tech`)
- Mix agents from different machines freely
- Remote agents display as `agentId@InstanceName`

---

## Remote Access (Tailscale)

ClawDeck works great over [Tailscale](https://tailscale.com) for secure remote access from any device.

During `install.sh`, choose **option 1** (host.docker.internal) for macOS/Windows Docker Desktop, or **option 3** (host network) for Linux.

Then set your Tailscale IP as the public backend URL when prompted:

```
Public backend URL: http://100.x.x.x:3001
```

Or manually in `.env`:

```env
NEXT_PUBLIC_BACKEND_URL=http://100.x.x.x:3001
```

---

## Troubleshooting

### Federation: Connection fails / timeout

**Check 1 — HTTP endpoints not enabled on remote machine**

The remote OpenClaw gateway must have `chatCompletions` and `responses` endpoints enabled. Run `bash federation-setup.sh` on the remote machine, or add manually to `~/.openclaw/openclaw.json` and restart the gateway.

**Check 2 — Gateway not reachable over Tailscale**

Verify both machines are on the same Tailscale network (`tailscale status`). The remote gateway must bind to the Tailscale interface — use `"bind": "tailnet"` in `openclaw.json`, not `"loopback"`.

**Check 3 — Firewall blocking the gateway port**

If the remote machine has a firewall (UFW, iptables, etc.), ensure the gateway port (default `18789`) is allowed from the Tailscale IP range. The `federation-setup.sh` script handles this automatically.

**Check 4 — Wrong token**

Copy the full token from the remote machine's `~/.openclaw/openclaw.json` → `gateway.auth.token`. It must match exactly.

### Cross-Instance Group Chat: agent returns 404

The remote agent's OpenClaw gateway does not have HTTP endpoints enabled. See Check 1 above.

### Gateway won't start after config change

Validate your JSON syntax — a trailing comma or missing bracket will prevent startup. Check `openclaw gateway status` for the specific error.

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
