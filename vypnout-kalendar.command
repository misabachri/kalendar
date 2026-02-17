#!/bin/zsh

set -euo pipefail

PORT=5173

PIDS="$(lsof -t -iTCP:${PORT} -sTCP:LISTEN || true)"

if [ -n "${PIDS}" ]; then
  kill ${PIDS}
fi
