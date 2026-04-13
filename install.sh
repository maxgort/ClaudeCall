#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== ClaudeCall installer ==="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required but not found on PATH." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ required, found $(node -v)." >&2
  exit 1
fi

echo "Installing npm dependencies..."
npm install --silent

echo
echo "Initializing ~/.claudecall/ ..."
node skill/scripts/init_db.mjs

echo
echo "Patching Claude Desktop config..."
node skill/scripts/install_config.mjs

echo
echo "=== Done ==="
echo
echo "Next steps:"
echo "  1. Edit ~/.claudecall/config.env with your credentials (SMTP, Vapi, Telegram)"
echo "  2. Edit ~/.claudecall/profile.json to match your style"
echo "  3. Restart Claude Desktop"
echo "  4. Try: 'Draft an email to someone@example.com saying hi'"
