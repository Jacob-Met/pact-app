#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 20 or newer, then run this launcher again." >&2
  exit 1
fi
exec node start-pact.mjs
