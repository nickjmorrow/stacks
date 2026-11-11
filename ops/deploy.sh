#!/bin/zsh
# Run on the Mac: test, copy the server to the server machine ($STACKS_DEPLOY_HOST, an ssh host, from .env),
# install runtime deps, (re)start it, and install the nightly backup. The repo's .env is copied too (ops/run.sh
# and ops/backup.sh read it). First run also adds the tailnet-only `tailscale serve` on :8450 (HTTPS) and :8451
# (TCP, for a Mac with Tailscale DNS off).
set -euo pipefail
cd "${0:A:h}/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
host="${STACKS_DEPLOY_HOST:?set STACKS_DEPLOY_HOST (an ssh host) in .env}"
pnpm test
pnpm exec tsc --noEmit
rsync -az --delete --exclude node_modules --exclude .git --exclude .superpowers --exclude .staging \
  --exclude app --exclude migration-report.md ./ "${host}:Projects/stacks/"
ssh "$host" 'zsh -lc "
  set -e
  export PATH=/opt/homebrew/bin:\$PATH
  cd ~/Projects/stacks && pnpm install --prod --frozen-lockfile >/dev/null
  mkdir -p ~/Stacks/Inbox
  for job in stacks stacks-backup; do
    plist=~/Library/LaunchAgents/com.nicholai.\$job.plist
    sed \"s|__HOME__|\$HOME|g\" ops/com.nicholai.\$job.plist > /tmp/com.nicholai.\$job.plist
    if ! cmp -s /tmp/com.nicholai.\$job.plist \$plist; then
      launchctl bootout gui/\$(id -u)/com.nicholai.\$job 2>/dev/null || true
      cp /tmp/com.nicholai.\$job.plist \$plist
      launchctl bootstrap gui/\$(id -u) \$plist
    elif [ \$job = stacks ]; then
      launchctl kickstart -k gui/\$(id -u)/com.nicholai.stacks
    fi
  done
  /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status | grep -q \":8450\" ||
    /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8450 http://127.0.0.1:8782 >/dev/null
  # A Mac with Tailscale DNS off reaches the server by IP on a plain tailnet-only TCP port.
  /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status | grep -q \"tcp://.*:8451\" ||
    /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --tcp=8451 tcp://127.0.0.1:8782 >/dev/null
"'
sleep 3
ssh "$host" 'curl -sf http://127.0.0.1:8782/api/health && echo " stacks is up" || (tail -20 ~/Library/Logs/stacks.log; exit 1)'
