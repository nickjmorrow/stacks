# Stacks

A personal books app: a library of EPUB and PDF books with tags, recommenders, ratings and notes, combined with looked-up author, year and summary, and a reader for iPhone, iPad and Mac. It replaces Apple Books for books you own as files.

Data originally lived in Grimoire notes as one page per book (format: [docs/title-page-format.md](docs/title-page-format.md)), read and written through Grimoire's `grim` CLI. It now lives in Stacks' own database (the catalog, `src/catalog/`); the Grimoire adapter and launch-day scripts remain for reference.

## Status

Split out of Hoard on 2026-10-20. What exists:

| Part | Where |
|---|---|
| Book page format, parsing and editing | `src/shared/` |
| Grimoire adapter (read, write, one-at-a-time writes, other-app guard) | `src/grimoire/` |
| Open Library lookup | `src/lookup/` |
| One-off migration of the old `books` list page | `scripts/migrate/` |
| Apple Books library import (on the Mac with the library; reads it read-only) | `scripts/import-apple-books/` |
| Skill draft for Claude | `skills/stacks/SKILL.md` |
| Server: store, files, library, edits, sync, reading log, lookups | `src/store/`, `src/files/`, `src/library/`, `src/sync/`, `src/enrich/`, `src/server/` |
| Launch-day scripts | `scripts/merge-pages/`, `scripts/stage-files/`, `scripts/add-files/`, `scripts/import-annotations/` |

The iPhone, iPad and Mac app (SwiftUI, Readium) is in `app/`; see `app/project.yml` and `app/generate-project.sh`.

## Commands

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm migrate --dry-run                         # against the saved books page
pnpm migrate --snapshot /tmp/books.json        # fresh copy of the live page
pnpm migrate --dry-run --from /tmp/books.json  # with name collisions
pnpm import-apple-books --dry-run
pnpm merge-pages --config lists.json           # dry run; --apply asks for "yes"
pnpm stage-files --out .staging                # on the Mac: Apple Books files → .staging/ + manifest.json
pnpm add-files --manifest .staging/manifest.json [--apply]          # store + files only, no Grimoire writes
pnpm import-annotations --staging .staging --server <url> [--apply] # highlights, notes, positions → the server
pnpm serve                                     # the server on 127.0.0.1:8782 (STACKS_HOME, STACKS_DB, PORT)
```

One-off launch-day order: migrate, import-apple-books, merge-pages, add-files, then import-annotations.

Real writes (`pnpm migrate --apply --from …`, `pnpm import-apple-books`) ask for a typed "yes" and are recorded as author `claude`, so they can be undone in Grimoire.

## Deploy

`ops/deploy.sh` (run on the Mac) tests, copies the server to `$STACKS_DEPLOY_HOST` over ssh and installs the launchd jobs in `ops/`. Machine-specific values live in the gitignored `.env` (see `.env.example`).
