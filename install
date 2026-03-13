#!/bin/bash
# Dex for Pi — One-command installer
# Usage: curl -fsSL https://heydex.ai/install | bash
#
# What this does:
# 1. Checks prerequisites (Node.js, git)
# 2. Installs Pi agent harness (if not already installed)
# 3. Installs the Dex Pi extension
# 4. Prompts for AI provider configuration
# 5. Verifies the installation

set -e

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}[dex]${NC} $1"; }
ok()    { echo -e "${GREEN}[dex]${NC} $1"; }
warn()  { echo -e "${YELLOW}[dex]${NC} $1"; }
fail()  { echo -e "${RED}[dex]${NC} $1"; exit 1; }

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}  ____           "
echo -e " |  _ \\  _____  __"
echo -e " | | | |/ _ \\ \\/ /"
echo -e " | |_| |  __/>  < "
echo -e " |____/ \\___/_/\\_\\"
echo -e "                   ${NC}"
echo -e " ${BOLD}Dex for Pi${NC} — Proactive AI Intelligence"
echo ""

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  fail "Node.js is required. Install it from https://nodejs.org (v18+)"
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js 18+ required. You have $(node -v)"
fi
ok "Node.js $(node -v)"

if ! command -v git &>/dev/null; then
  fail "Git is required. Install it from https://git-scm.com"
fi
ok "Git $(git --version | cut -d' ' -f3)"

# ---------------------------------------------------------------------------
# Install Pi (if needed)
# ---------------------------------------------------------------------------
if command -v pi &>/dev/null; then
  ok "Pi agent harness already installed ($(pi --version 2>/dev/null || echo 'installed'))"
else
  info "Installing Pi agent harness..."
  if command -v bun &>/dev/null; then
    bun install -g @mariozechner/pi-coding-agent
  elif command -v npm &>/dev/null; then
    npm install -g @mariozechner/pi-coding-agent
  else
    fail "npm or bun required to install Pi"
  fi
  ok "Pi agent harness installed"
fi

# ---------------------------------------------------------------------------
# Install Dex extension
# ---------------------------------------------------------------------------
PI_EXT_DIR="$HOME/.pi/agent/extensions"
DEX_EXT_DIR="$PI_EXT_DIR/dex"

info "Installing Dex extension..."

mkdir -p "$PI_EXT_DIR"

if [ -d "$DEX_EXT_DIR" ]; then
  warn "Dex extension already exists at $DEX_EXT_DIR"
  read -p "  Overwrite? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "Keeping existing installation"
  else
    rm -rf "$DEX_EXT_DIR"
  fi
fi

if [ ! -d "$DEX_EXT_DIR" ]; then
  git clone --depth 1 https://github.com/davekilleen/dex-pi.git /tmp/dex-pi-install 2>/dev/null
  cp -r /tmp/dex-pi-install/extensions/dex "$DEX_EXT_DIR"
  rm -rf /tmp/dex-pi-install

  # Install dependencies
  cd "$DEX_EXT_DIR"
  if command -v bun &>/dev/null; then
    bun install --production 2>/dev/null
  elif command -v npm &>/dev/null; then
    npm install --production 2>/dev/null
  fi
  cd - >/dev/null

  ok "Dex extension installed at $DEX_EXT_DIR"
fi

# ---------------------------------------------------------------------------
# AI Provider setup
# ---------------------------------------------------------------------------
echo ""
info "Configure your AI provider"
echo ""
echo "  Which AI provider do you want to use?"
echo ""
echo "  1) Anthropic (Claude) — best quality"
echo "  2) OpenAI (GPT) — widely available"
echo "  3) Google (Gemini) — good value"
echo "  4) Local model (Ollama) — free, private"
echo "  5) Skip — I'll configure later"
echo ""
read -p "  Choice (1-5): " -n 1 -r PROVIDER_CHOICE
echo ""

case $PROVIDER_CHOICE in
  1)
    PROVIDER="anthropic"
    read -p "  Anthropic API key (sk-ant-...): " API_KEY
    ;;
  2)
    PROVIDER="openai"
    read -p "  OpenAI API key (sk-...): " API_KEY
    ;;
  3)
    PROVIDER="google"
    read -p "  Google AI API key: " API_KEY
    ;;
  4)
    PROVIDER="ollama"
    API_KEY=""
    info "Make sure Ollama is running locally (https://ollama.ai)"
    ;;
  5)
    PROVIDER=""
    API_KEY=""
    warn "Skipped — configure your provider in Pi settings before first use"
    ;;
esac

if [ -n "$PROVIDER" ] && [ "$PROVIDER" != "ollama" ] && [ -n "$API_KEY" ]; then
  # Write provider config
  PI_CONFIG_DIR="$HOME/.pi"
  mkdir -p "$PI_CONFIG_DIR"
  cat > "$PI_CONFIG_DIR/provider.json" << PROVIDER_EOF
{
  "provider": "$PROVIDER",
  "apiKey": "$API_KEY"
}
PROVIDER_EOF
  chmod 600 "$PI_CONFIG_DIR/provider.json"
  ok "Provider configured: $PROVIDER"
fi

# ---------------------------------------------------------------------------
# Langfuse (optional)
# ---------------------------------------------------------------------------
echo ""
read -p "  Enable cost tracking with Langfuse? (y/N) " -n 1 -r LANGFUSE_CHOICE
echo ""

if [[ $LANGFUSE_CHOICE =~ ^[Yy]$ ]]; then
  read -p "  Langfuse public key (pk-lf-...): " LF_PUBLIC
  read -p "  Langfuse secret key (sk-lf-...): " LF_SECRET
  read -p "  Your name/ID for attribution: " LF_USER

  mkdir -p "$DEX_EXT_DIR"
  cat > "$DEX_EXT_DIR/.env" << ENV_EOF
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=$LF_PUBLIC
LANGFUSE_SECRET_KEY=$LF_SECRET
LANGFUSE_HOST=https://cloud.langfuse.com
LANGFUSE_USER_ID=$LF_USER
LANGFUSE_PII_MODE=metadata
ENV_EOF
  chmod 600 "$DEX_EXT_DIR/.env"
  ok "Langfuse cost tracking enabled"
else
  info "Skipped — you can enable Langfuse later"
fi

# ---------------------------------------------------------------------------
# Vault setup
# ---------------------------------------------------------------------------
echo ""
info "Where is your vault? (the folder where your notes/docs live)"
read -p "  Path (or press Enter for current directory): " VAULT_PATH
VAULT_PATH="${VAULT_PATH:-$(pwd)}"

if [ ! -d "$VAULT_PATH" ]; then
  fail "Directory not found: $VAULT_PATH"
fi

ok "Vault: $VAULT_PATH"

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
echo ""
info "Verifying installation..."

CHECKS_PASSED=0
CHECKS_TOTAL=4

if [ -d "$DEX_EXT_DIR" ]; then
  ok "Dex extension installed"; CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  warn "Dex extension not found"
fi

if [ -f "$DEX_EXT_DIR/index.ts" ]; then
  ok "Extension entry point found"; CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  warn "Extension entry point missing"
fi

if [ -d "$DEX_EXT_DIR/hooks" ]; then
  HOOK_COUNT=$(ls "$DEX_EXT_DIR/hooks/"*.ts 2>/dev/null | wc -l | tr -d ' ')
  ok "$HOOK_COUNT hook modules installed"; CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  warn "Hooks directory missing"
fi

if [ -d "$DEX_EXT_DIR/observability" ]; then
  ok "Observability module installed"; CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  warn "Observability module missing"
fi

echo ""
echo -e "${BOLD}  Installation complete: $CHECKS_PASSED/$CHECKS_TOTAL checks passed${NC}"
echo ""
echo "  To start Dex on Pi:"
echo ""
echo -e "    ${BOLD}cd $VAULT_PATH && pi${NC}"
echo ""
echo "  Dex will activate automatically — context injection,"
echo "  safety guards, cost tracking, and learning are all on."
echo ""
echo -e "  ${BLUE}Documentation:${NC} https://heydex.ai/docs/pi"
echo -e "  ${BLUE}Support:${NC} https://github.com/davekilleen/dex-pi/issues"
echo ""
echo -e "  ${GREEN}Welcome to Dex for Pi.${NC}"
echo ""
