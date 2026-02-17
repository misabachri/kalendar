#!/bin/zsh

set -euo pipefail

cd "$(dirname "$0")"

PORT=5173
URL="http://localhost:${PORT}"

if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  open "${URL}"
  exit 0
fi

if [ ! -d node_modules ]; then
  npm install
fi

nohup npm run dev >/tmp/kalendar-dev.log 2>&1 &

sleep 2
open "${URL}"
