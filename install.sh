#!/usr/bin/env bash
# ClawDeck Installer
# Automatically detects your OpenClaw setup and generates .env + docker-compose.yml
# Usage: bash install.sh

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════╗"
echo "  ║   ClawDeck Installer v1.0     ║"
echo "  ╚═══════════════════════════════╝"
echo -e "${NC}"

# ─── Helpers ────────────────────────────────────────────────────────────────

prompt() {
  local var="$1" msg="$2" default="$3"
  if [ -n "$default" ]; then
    read -rp "$(echo -e "${CYAN}${msg}${NC} [${default}]: ")" val
    eval "$var=\"${val:-$default}\""
  else
    read -rp "$(echo -e "${CYAN}${msg}${NC}: ")" val
    eval "$var=\"$val\""
  fi
}

prompt_secret() {
  local var="$1" msg="$2"
  read -rsp "$(echo -e "${CYAN}${msg}${NC}: ")" val
  echo
  eval "$var=\"$val\""
}

info()    { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
section() { echo -e "\n${BOLD}── $1 ──${NC}"; }

gen_secret() {
  openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' || echo "change-me-$(date +%s)"
}

# ─── Step 1: Detect OpenClaw config ─────────────────────────────────────────

section "Detecting OpenClaw installation"

OPENCLAW_DIR="${HOME}/.openclaw"
OPENCLAW_JSON="${OPENCLAW_DIR}/openclaw.json"

if [ ! -f "$OPENCLAW_JSON" ]; then
  warn "openclaw.json not found at $OPENCLAW_JSON"
  prompt OPENCLAW_JSON "Path to openclaw.json" "$OPENCLAW_JSON"
fi

# Extract gateway port and token from openclaw.json
GATEWAY_PORT=$(python3 -c "import json,sys; d=json.load(open('$OPENCLAW_JSON')); print(d.get('gateway',{}).get('port', 18789))" 2>/dev/null || echo "18789")
GATEWAY_TOKEN_DETECTED=$(python3 -c "import json,sys; d=json.load(open('$OPENCLAW_JSON')); print(d.get('gateway',{}).get('auth',{}).get('token','') or d.get('gateway',{}).get('token',''))" 2>/dev/null || echo "")

info "Gateway port: $GATEWAY_PORT"

if [ -n "$GATEWAY_TOKEN_DETECTED" ]; then
  info "Gateway token detected from openclaw.json"
  GATEWAY_TOKEN="$GATEWAY_TOKEN_DETECTED"
else
  warn "Could not auto-detect gateway token"
  prompt_secret GATEWAY_TOKEN "Enter your OpenClaw gateway token (from openclaw.json → gateway.token)"
fi

# ─── Step 2: Detect agents & workspaces ──────────────────────────────────────

section "Detecting agents and workspaces"

AGENTS_DIR="${OPENCLAW_DIR}/agents"
declare -a AGENT_IDS=()
declare -A WORKSPACE_MAP=()

if [ -d "$AGENTS_DIR" ]; then
  for agent_dir in "$AGENTS_DIR"/*/; do
    agent_id=$(basename "$agent_dir")
    # Try to find workspace path from agent config
    agent_json="${agent_dir}agent/agent.json"
    workspace=""
    if [ -f "$agent_json" ]; then
      workspace=$(python3 -c "import json; d=json.load(open('$agent_json')); print(d.get('workspace',''))" 2>/dev/null || echo "")
    fi
    # Fallback: check common workspace patterns
    if [ -z "$workspace" ]; then
      if [ "$agent_id" = "main" ]; then
        workspace="${OPENCLAW_DIR}/workspace"
      else
        workspace="${OPENCLAW_DIR}/workspace-${agent_id}"
      fi
    fi
    AGENT_IDS+=("$agent_id")
    WORKSPACE_MAP["$agent_id"]="$workspace"
    if [ -d "$workspace" ]; then
      info "Agent: ${agent_id} → ${workspace}"
    else
      warn "Agent: ${agent_id} → ${workspace} (workspace dir not found)"
    fi
  done
else
  warn "No agents dir found at $AGENTS_DIR — will prompt manually"
fi

if [ ${#AGENT_IDS[@]} -eq 0 ]; then
  warn "No agents auto-detected. Please add agents manually."
  prompt MANUAL_AGENT "Agent ID (e.g. main)" "main"
  prompt MANUAL_WS "Workspace path" "${HOME}/.openclaw/workspace"
  AGENT_IDS+=("$MANUAL_AGENT")
  WORKSPACE_MAP["$MANUAL_AGENT"]="$MANUAL_WS"
fi

# ─── Step 3: Admin credentials ───────────────────────────────────────────────

section "Admin credentials"

prompt ADMIN_USERNAME "Admin username" "admin"

while true; do
  prompt_secret ADMIN_PASSWORD "Admin password"
  prompt_secret ADMIN_PASSWORD2 "Confirm password"
  if [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ]; then
    break
  fi
  warn "Passwords don't match, try again"
done

# Hash password with bcrypt (requires htpasswd or node)
if command -v node &>/dev/null; then
  ADMIN_PASSWORD_HASH=$(node -e "
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(process.argv[1], 10);
    console.log(hash);
  " "$ADMIN_PASSWORD" 2>/dev/null || echo "")
fi

if [ -z "$ADMIN_PASSWORD_HASH" ]; then
  warn "Could not hash password with bcrypt (bcryptjs not available). Will store plain password."
  ADMIN_PASSWORD_HASH=""
fi

# ─── Step 4: Network mode ────────────────────────────────────────────────────

section "Network configuration"

echo "How is Docker connecting to your host?"
echo "  1) host.docker.internal (macOS / Windows / Docker Desktop)"
echo "  2) 172.17.0.1 (Linux bridge)"
echo "  3) host network mode (Linux, same as host)"
echo "  4) Custom IP"
prompt NET_MODE "Choice" "3"

case "$NET_MODE" in
  1) GATEWAY_HOST="host.docker.internal"; NETWORK_MODE="bridge" ;;
  2) GATEWAY_HOST="172.17.0.1"; NETWORK_MODE="bridge" ;;
  3) GATEWAY_HOST="127.0.0.1"; NETWORK_MODE="host" ;;
  4)
    prompt GATEWAY_HOST "Enter host IP/hostname"
    NETWORK_MODE="bridge"
    ;;
  *) GATEWAY_HOST="127.0.0.1"; NETWORK_MODE="host" ;;
esac

GATEWAY_URL="http://${GATEWAY_HOST}:${GATEWAY_PORT}"
info "Gateway URL: $GATEWAY_URL"
info "Docker network mode: $NETWORK_MODE"

prompt FRONTEND_PORT "Frontend port" "3000"
prompt BACKEND_PORT  "Backend port"  "3001"

# Public URL (for mobile/remote access)
prompt PUBLIC_URL "Public backend URL (leave blank for localhost only)" "http://localhost:${BACKEND_PORT}"

# ─── Step 5: Generate .env ───────────────────────────────────────────────────

section "Generating .env"

JWT_SECRET=$(gen_secret)

# Build WORKSPACE env vars
WORKSPACE_ENV=""
for agent_id in "${AGENT_IDS[@]}"; do
  ws="${WORKSPACE_MAP[$agent_id]}"
  env_key="WORKSPACE_$(echo "$agent_id" | tr '[:lower:]-' '[:upper:]_')"
  WORKSPACE_ENV="${WORKSPACE_ENV}${env_key}=${ws}\n"
done

# Build AGENT_IDS env var (comma-separated)
AGENT_IDS_STR=$(IFS=,; echo "${AGENT_IDS[*]}")

cat > .env << EOF
# ClawDeck Configuration
# Generated by install.sh on $(date)

# Admin credentials
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=${GATEWAY_URL}
OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}

# Agents (comma-separated agent IDs)
CLAWDECK_AGENTS=${AGENT_IDS_STR}

# Workspace paths (auto-detected)
$(echo -e "$WORKSPACE_ENV")

# Ports
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}

# Environment
NODE_ENV=production

# Frontend public URL
NEXT_PUBLIC_BACKEND_URL=${PUBLIC_URL}
EOF

info ".env generated"

# ─── Step 6: Generate docker-compose.yml ─────────────────────────────────────

section "Generating docker-compose.yml"

# Build volumes section
VOLUMES_YAML=""
for agent_id in "${AGENT_IDS[@]}"; do
  ws="${WORKSPACE_MAP[$agent_id]}"
  if [ -d "$ws" ]; then
    VOLUMES_YAML="${VOLUMES_YAML}      - ${ws}:${ws}:rw\n"
  fi
done
VOLUMES_YAML="${VOLUMES_YAML}      - /tmp/openclaw:/tmp/openclaw:ro"

# Network mode specific config
if [ "$NETWORK_MODE" = "host" ]; then
  NETWORK_CONFIG="network_mode: host"
  PORTS_FRONTEND=""
  PORTS_BACKEND=""
else
  NETWORK_CONFIG="ports:
      - \"${FRONTEND_PORT}:3000\""
  PORTS_BACKEND="    ports:
      - \"${BACKEND_PORT}:${BACKEND_PORT}\""
fi

cat > docker-compose.yml << EOF
# ClawDeck docker-compose.yml
# Generated by install.sh on $(date)

$([ "$NETWORK_MODE" = "bridge" ] && echo "networks:
  clawdeck-net:
    driver: bridge
" || echo "")
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: clawdeck-backend
    restart: unless-stopped
$([ "$NETWORK_MODE" = "host" ] && echo "    network_mode: host" || echo "    networks:
      - clawdeck-net
    extra_hosts:
      - \"host.docker.internal:host-gateway\"
    ports:
      - \"${BACKEND_PORT}:${BACKEND_PORT}\"")
    volumes:
$(echo -e "$VOLUMES_YAML")
    env_file:
      - .env
    environment:
      - NODE_ENV=\${NODE_ENV:-production}
      - BACKEND_PORT=\${BACKEND_PORT:-${BACKEND_PORT}}
      - FRONTEND_URL=http://localhost:${FRONTEND_PORT}
      - ADMIN_USERNAME=\${ADMIN_USERNAME}
      - ADMIN_PASSWORD_HASH=\${ADMIN_PASSWORD_HASH}
      - ADMIN_PASSWORD=\${ADMIN_PASSWORD}
      - JWT_SECRET=\${JWT_SECRET}
      - JWT_EXPIRES_IN=\${JWT_EXPIRES_IN:-24h}
      - OPENCLAW_GATEWAY_URL=\${OPENCLAW_GATEWAY_URL}
      - OPENCLAW_GATEWAY_TOKEN=\${OPENCLAW_GATEWAY_TOKEN}
      - CLAWDECK_AGENTS=\${CLAWDECK_AGENTS}
$(for agent_id in "${AGENT_IDS[@]}"; do
  env_key="WORKSPACE_$(echo "$agent_id" | tr '[:lower:]-' '[:upper:]_')"
  echo "      - ${env_key}=\${${env_key}}"
done)
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:${BACKEND_PORT}/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        - NEXT_PUBLIC_BACKEND_URL=${PUBLIC_URL}
    container_name: clawdeck-frontend
    restart: unless-stopped
$([ "$NETWORK_MODE" = "host" ] && echo "    network_mode: host" || echo "    networks:
      - clawdeck-net
    ports:
      - \"${FRONTEND_PORT}:3000\"")
    env_file:
      - .env
    environment:
      - NODE_ENV=\${NODE_ENV:-production}
      - BACKEND_INTERNAL_URL=$([ "$NETWORK_MODE" = "host" ] && echo "http://localhost:${BACKEND_PORT}" || echo "http://clawdeck-backend:${BACKEND_PORT}")
      - NEXT_PUBLIC_BACKEND_URL=\${NEXT_PUBLIC_BACKEND_URL}
    depends_on:
      backend:
        condition: service_healthy
EOF

info "docker-compose.yml generated"

# ─── Step 7: Build & launch ───────────────────────────────────────────────────

section "Ready to launch"

echo -e "\n${BOLD}Configuration summary:${NC}"
echo "  Gateway:     $GATEWAY_URL"
echo "  Agents:      $AGENT_IDS_STR"
echo "  Frontend:    http://localhost:${FRONTEND_PORT}"
echo "  Admin user:  $ADMIN_USERNAME"
echo ""

prompt LAUNCH "Build and start ClawDeck now? (y/n)" "y"

if [[ "$LAUNCH" =~ ^[Yy] ]]; then
  echo -e "\n${CYAN}Building and starting ClawDeck...${NC}"
  docker compose up -d --build
  echo ""
  echo -e "${GREEN}${BOLD}✅ ClawDeck is running!${NC}"
  echo -e "   Open: ${CYAN}http://localhost:${FRONTEND_PORT}${NC}"
  echo -e "   Login: ${ADMIN_USERNAME} / (your password)"
else
  echo ""
  info "Run manually: docker compose up -d --build"
fi

echo ""
echo -e "${YELLOW}Note: .env contains sensitive tokens — do not commit it to git.${NC}"
echo -e "${BOLD}Done!${NC}"
