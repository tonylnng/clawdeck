#!/bin/bash
set -e

echo ""
echo "╔════════════════════════════════════════╗"
echo "║  ClawDeck Federation Proxy — Install   ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "❌ Docker not found. Please install Docker first: https://docs.docker.com/get-docker/"
  exit 1
fi

# Check if .env exists
if [ -f ".env" ]; then
  echo "⚠️  .env already exists. Edit it manually if needed."
else
  cp .env.example .env

  echo "Let's configure your Federation Proxy."
  echo ""

  # Federation Token
  RANDOM_TOKEN=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
  read -p "Federation Token (press Enter to auto-generate): " FED_TOKEN
  FED_TOKEN="${FED_TOKEN:-$RANDOM_TOKEN}"
  sed -i "s/your-federation-token-here/$FED_TOKEN/" .env

  # Gateway URL
  read -p "OpenClaw Gateway URL [http://host.docker.internal:18789]: " GW_URL
  GW_URL="${GW_URL:-http://host.docker.internal:18789}"
  sed -i "s|http://host.docker.internal:18789|$GW_URL|" .env

  # Gateway Token
  read -p "OpenClaw Gateway Token (from ~/.openclaw/openclaw.json): " GW_TOKEN
  if [ -n "$GW_TOKEN" ]; then
    sed -i "s/your-openclaw-gateway-token-here/$GW_TOKEN/" .env
  fi

  # Tailscale IP
  if command -v tailscale &>/dev/null; then
    TS_IP=$(tailscale ip -4 2>/dev/null || echo "")
    if [ -n "$TS_IP" ]; then
      echo ""
      echo "✅ Tailscale detected! Your Tailscale IP: $TS_IP"
      read -p "Restrict to Tailscale connections only? [Y/n]: " RESTRICT
      RESTRICT="${RESTRICT:-Y}"
      if [[ "$RESTRICT" =~ ^[Yy] ]]; then
        sed -i "s/ALLOWED_IPS=100.64.0.0\/10/ALLOWED_IPS=100.64.0.0\/10/" .env
        echo "   IP Allowlist set to Tailscale range (100.64.0.0/10)"
      fi
    fi
  fi

  echo ""
  echo "✅ .env configured!"
  echo ""
  echo "Your Federation Token (save this for ClawDeck Hub):"
  echo "  $FED_TOKEN"
  echo ""
fi

# Build and start
echo "Building and starting Federation Proxy..."
docker compose up -d --build

echo ""
echo "╔════════════════════════════════════════╗"
echo "║  Federation Proxy is running!          ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Health check: http://localhost:18790/health"
echo ""
echo "Next step: Add this machine to ClawDeck Hub:"
echo "  → ClawDeck → Instances → Add Instance"
echo "  → URL: http://<this-machine-tailscale-ip>:18790"
echo "  → Token: (the Federation Token shown above)"
echo ""
