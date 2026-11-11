#!/bin/zsh
# Launched by launchd on the server (com.nicholai.stacks). No secrets: Open Library needs no key.
# Machine-specific values (GRIMOIRE_GRAPH, STACKS_TZ, ...) come from the repo's .env when present.
cd "${0:A:h}/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export GRIMOIRE_GRAPH="${GRIMOIRE_GRAPH:-$HOME/Grimoire}"
export PORT=8782
export STACKS_HOME="$HOME/Stacks"
export TZ="${STACKS_TZ:-UTC}"
exec /opt/homebrew/bin/node src/server/main.ts
