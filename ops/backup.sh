#!/bin/zsh
# Nightly on the server (com.nicholai.stacks-backup): copies Stacks' books, covers and database into
# $STACKS_BACKUP_DIR (set in the repo's .env; e.g. a synced, off-site folder). The database is copied
# with SQLite's backup command so a running server can't leave a half-written copy.
set -euo pipefail
cd "${0:A:h}/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
src="$HOME/Stacks"
dest="${STACKS_BACKUP_DIR:-$HOME/StacksBackup}"
db="$HOME/Library/Application Support/stacks/stacks.db"
mkdir -p "$dest"
rsync -a --delete "$src/files/" "$dest/files/"
rsync -a --delete "$src/covers/" "$dest/covers/"
/usr/bin/sqlite3 "$db" ".backup '$dest/stacks.db.tmp'"
mv "$dest/stacks.db.tmp" "$dest/stacks.db"
echo "$(date '+%Y-%m-%d %H:%M') backed up $(ls "$dest/files" | wc -l | tr -d ' ') files"
