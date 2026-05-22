#!/usr/bin/env bash
# Swap the active demo client. Run from anywhere.
#
# Usage:
#   bin/swap-demo.sh                    # list available demos
#   bin/swap-demo.sh quiet-golf         # swap to quiet-golf
#   bin/swap-demo.sh sample-saas        # swap to sample-saas
#
# What it does:
#   1. Copies config/demos/<name>.json → config/demo.json
#   2. If running inside docker compose, restarts the app service
#
# To create a new demo: copy config/demos/sample-saas.json to
# config/demos/<your-client>.json, edit the values, then run this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMOS_DIR="$REPO_ROOT/config/demos"
ACTIVE="$REPO_ROOT/config/demo.json"

if [ ! -d "$DEMOS_DIR" ]; then
  echo "error: $DEMOS_DIR does not exist" >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "Available demos:"
  for f in "$DEMOS_DIR"/*.json; do
    name="$(basename "$f" .json)"
    client="$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
    echo "  $name  →  $client"
  done
  echo
  echo "Currently active:"
  if [ -f "$ACTIVE" ]; then
    grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$ACTIVE" | head -1 | sed 's/.*"\([^"]*\)"$/  \1/'
  else
    echo "  (none)"
  fi
  echo
  echo "Usage: $0 <demo-name>"
  exit 0
fi

NAME="$1"
SRC="$DEMOS_DIR/$NAME.json"

if [ ! -f "$SRC" ]; then
  echo "error: $SRC does not exist" >&2
  echo "Available demos:"
  ls "$DEMOS_DIR" | sed 's/\.json$//' | sed 's/^/  /'
  exit 1
fi

cp "$SRC" "$ACTIVE"
echo "✓ Swapped to $NAME"
client="$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$ACTIVE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
echo "  Active client: $client"

# If docker compose is up, restart the app so it reloads
if command -v docker >/dev/null && docker compose -f "$REPO_ROOT/deploy/docker-compose.yml" ps app 2>/dev/null | grep -q "running\|Up"; then
  echo "  Restarting app container…"
  (cd "$REPO_ROOT/deploy" && docker compose restart app)
fi
