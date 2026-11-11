#!/bin/sh
# Generates app/Stacks.xcodeproj, injecting machine-specific values from ../.env (see .env.example).
set -e
app="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$app/../.env" ]; then set -a; . "$app/../.env"; set +a; fi
export STACKS_SERVER_URL="${STACKS_SERVER_URL:-}"
cd "$app"
xcodegen generate "$@"
