#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ClawDeck Federation Setup — Remote Machine Preparation Script
# Run this on each REMOTE machine you want to connect to ClawDeck Hub.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

OPENCLAW_CONFIG="${HOME}/.openclaw/openclaw.json"
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     ClawDeck Federation — Remote Machine Setup       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Check OpenClaw ────────────────────────────────────────────────────
echo -e "${BOLD}[1/4] Checking OpenClaw installation...${NC}"

if ! command -v openclaw &>/dev/null; then
  echo -e "${RED}✗ OpenClaw not found. Please install OpenClaw first: https://openclaw.ai${NC}"
  exit 1
fi

if [ ! -f "$OPENCLAW_CONFIG" ]; then
  echo -e "${RED}✗ openclaw.json not found at $OPENCLAW_CONFIG${NC}"
  exit 1
fi

echo -e "${GREEN}✓ OpenClaw found${NC}"

# ── Step 2: Check / Install Tailscale ────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/4] Checking Tailscale...${NC}"

if ! command -v tailscale &>/dev/null; then
  echo -e "${YELLOW}⚠ Tailscale not installed. Installing now...${NC}"
  curl -fsSL https://tailscale.com/install.sh | sh
  echo ""
  echo -e "${YELLOW}Tailscale installed. Please run:${NC}"
  echo -e "  sudo tailscale up"
  echo -e "Then re-run this script."
  exit 0
fi

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
if [ -z "$TAILSCALE_IP" ]; then
  echo -e "${YELLOW}⚠ Tailscale is installed but not connected.${NC}"
  echo -e "  Run: sudo tailscale up"
  echo -e "Then re-run this script."
  exit 0
fi

echo -e "${GREEN}✓ Tailscale connected — IP: ${TAILSCALE_IP}${NC}"

# ── Step 3: Update openclaw.json ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/4] Updating openclaw.json...${NC}"

# Detect existing gateway port
GATEWAY_PORT=$(python3 -c "
import json, sys
try:
  d = json.load(open('$OPENCLAW_CONFIG'))
  print(d.get('gateway', {}).get('port', 18789))
except:
  print(18789)
" 2>/dev/null || echo "18789")

echo "  Detected gateway port: $GATEWAY_PORT"

# Backup first
cp "$OPENCLAW_CONFIG" "${OPENCLAW_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
echo -e "  ${GREEN}✓ Backed up to ${OPENCLAW_CONFIG}.bak.*${NC}"

# Patch with python3 (preserves all existing config, only adds/updates what's needed)
python3 - <<PYEOF
import json, sys

config_path = "$OPENCLAW_CONFIG"

with open(config_path, 'r') as f:
    config = json.load(f)

changed = []

# Ensure gateway section exists
if 'gateway' not in config:
    config['gateway'] = {}

# 1. bind: tailnet (listen on Tailscale interface)
if config['gateway'].get('bind') != 'tailnet':
    config['gateway']['bind'] = 'tailnet'
    changed.append('gateway.bind → "tailnet"')

# 2. tailscale.mode: off (bind=tailnet works without serve/funnel)
if 'tailscale' not in config['gateway']:
    config['gateway']['tailscale'] = {}
if config['gateway']['tailscale'].get('mode') != 'off':
    config['gateway']['tailscale']['mode'] = 'off'
    changed.append('gateway.tailscale.mode → "off"')

# 3. http.endpoints: chatCompletions + responses
if 'http' not in config['gateway']:
    config['gateway']['http'] = {}
if 'endpoints' not in config['gateway']['http']:
    config['gateway']['http']['endpoints'] = {}

ep = config['gateway']['http']['endpoints']
if not ep.get('chatCompletions', {}).get('enabled'):
    ep['chatCompletions'] = {'enabled': True}
    changed.append('gateway.http.endpoints.chatCompletions → enabled')
if not ep.get('responses', {}).get('enabled'):
    ep['responses'] = {'enabled': True}
    changed.append('gateway.http.endpoints.responses → enabled')

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')

if changed:
    for c in changed:
        print(f'  ✓ Set {c}')
else:
    print('  ✓ Already correctly configured (no changes needed)')
PYEOF

echo -e "${GREEN}✓ openclaw.json updated${NC}"

# ── Step 4: Firewall ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/4] Configuring firewall (UFW)...${NC}"

TAILSCALE_RANGE="100.64.0.0/10"

if command -v ufw &>/dev/null; then
  UFW_STATUS=$(sudo ufw status 2>/dev/null || echo "inactive")

  if echo "$UFW_STATUS" | grep -q "Status: active"; then
    # Check if rule already exists
    if sudo ufw status | grep -q "${GATEWAY_PORT}/tcp" && sudo ufw status | grep -q "$TAILSCALE_RANGE"; then
      echo -e "${GREEN}✓ UFW rule already exists for port ${GATEWAY_PORT} from Tailscale range${NC}"
    else
      sudo ufw allow from "$TAILSCALE_RANGE" to any port "$GATEWAY_PORT" proto tcp comment "ClawDeck Federation"
      echo -e "${GREEN}✓ UFW: allowed port ${GATEWAY_PORT}/tcp from Tailscale range (${TAILSCALE_RANGE})${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ UFW is not active — skipping firewall configuration${NC}"
    echo -e "  If you have another firewall, allow port ${GATEWAY_PORT}/tcp from ${TAILSCALE_RANGE}"
  fi
else
  echo -e "${YELLOW}⚠ UFW not found — skipping firewall configuration${NC}"
  echo -e "  Manually allow port ${GATEWAY_PORT}/tcp from ${TAILSCALE_RANGE} in your firewall"
fi

# ── Restart Gateway ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Restarting OpenClaw gateway...${NC}"

if openclaw gateway restart 2>/dev/null; then
  sleep 2
  echo -e "${GREEN}✓ Gateway restarted${NC}"
else
  echo -e "${YELLOW}⚠ Could not restart automatically. Please run: openclaw gateway restart${NC}"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                    Setup Complete!                   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}This machine is ready for ClawDeck Federation.${NC}"
echo ""
echo -e "  Add it in ClawDeck → Instances (g+f):"
echo -e "  ${BOLD}URL:${NC}   http://${TAILSCALE_IP}:${GATEWAY_PORT}"
echo ""

# Show gateway token (redacted)
GATEWAY_TOKEN=$(python3 -c "
import json
try:
  d = json.load(open('$OPENCLAW_CONFIG'))
  t = d.get('gateway', {}).get('auth', {}).get('token', '')
  if t:
    print(t[:8] + '...' + t[-4:])
  else:
    print('(check ~/.openclaw/openclaw.json → gateway.auth.token)')
except:
  print('(check ~/.openclaw/openclaw.json → gateway.auth.token)')
" 2>/dev/null)

echo -e "  ${BOLD}Token:${NC} $GATEWAY_TOKEN"
echo ""
echo -e "  ${YELLOW}Note: Copy the full token from ~/.openclaw/openclaw.json${NC}"
echo ""
