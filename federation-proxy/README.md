# ClawDeck Federation Proxy

A lightweight security proxy that sits between ClawDeck Hub and your local OpenClaw Gateway.

## Why?

By default, ClawDeck connects directly to remote OpenClaw gateways using their Gateway Token.
Federation Proxy adds an extra security layer:

- Your real Gateway Token **never leaves this machine**
- ClawDeck Hub uses a separate **Federation Token** (easy to rotate/revoke)
- Built-in **rate limiting**, **IP allowlist**, and **audit logging**

> **Most users don't need this.** Direct connection via Tailscale is already secure.
> Install this if you have stricter security requirements or a production environment.

## Quick Install

```bash
git clone https://github.com/tonylnng/clawdeck.git
cd clawdeck/federation-proxy
bash install.sh
```

## Manual Setup

```bash
cp .env.example .env
# Edit .env with your values
docker compose up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FEDERATION_TOKEN` | ✅ | — | Token ClawDeck Hub uses to authenticate |
| `GATEWAY_TOKEN` | ✅ | — | Your local OpenClaw Gateway Token |
| `GATEWAY_URL` | — | `http://host.docker.internal:18789` | Local gateway URL |
| `BIND_HOST` | — | `0.0.0.0` | Set to Tailscale IP to restrict access |
| `ALLOWED_IPS` | — | `` (all) | Comma-separated IPs/CIDRs to allowlist |
| `RATE_LIMIT_RPM` | — | `120` | Max requests per minute per IP |
| `AUDIT_LOG` | — | `true` | Write audit log to `/app/logs/audit.jsonl` |

## Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | None | Health check |
| `GET /security/summary` | Federation Token | Last 1h security stats |
| `ALL /*` | Federation Token | Proxy to local gateway |

## Logs

```bash
# View audit log
docker exec clawdeck-federation-proxy tail -f /app/logs/audit.jsonl

# Or via volume
docker compose logs -f
```
