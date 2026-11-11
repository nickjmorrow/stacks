<img src="app/icons/stacks/linux/hicolor/256x256/apps/stacks.png" width="96" align="right" alt="Stacks icon">

# Stacks

A self-hosted library and reader for the EPUB and PDF books you own: a small Node server keeps the files and the catalog, and a SwiftUI app reads and syncs them on iPhone, iPad and Mac.

## What it does

- **Catalog.** Status, 1-to-5 rating, tags in your own groups, who recommended it, finished date and progress for every book, plus author, year, genre and summary looked up from Open Library. Books without a clear match wait in "Needs a look" until they are matched to an Open Library work by hand.
- **Adding books.** Drop a file in the server's Inbox folder, open it with Stacks on a device, or use "Open in Stacks" from Files, Safari or Mail (share extension); the app uploads it on its next sync. The server reads the EPUB's own metadata (title, authors, ISBN, cover) and saves a cover image.
- **Reader.** EPUB and PDF through Readium, plus a custom continuous-scroll mode for reflowable EPUBs. Highlights and margin notes, per-device themes (Night, Midnight Sun, Paper, System), bundled Literata and Atkinson Hyperlegible fonts, size, spacing and margins.
- **Sync across devices.** Each device keeps a full offline copy of the library (downloads checked by SHA-256, resumable with HTTP Range) and its own SQLite database. Positions, highlights, notes, reading sessions and edits queue locally and sync with a cursor, so you pick up where you stopped on any device.
- **Reading habit.** Sessions are timed as you read; a daily goal, streak and week strip appear in the app and in a home-screen widget that links straight into the books you're reading.
- **Imports.** One-off scripts bring in an Apple Books library with its highlights, notes and positions.

## How it works

```
 iPhone / iPad / Mac app ──HTTP /api──▶ Node server (Hono) ──▶ SQLite (node:sqlite)
   StacksKit: local GRDB store,              │                    catalog, files, positions,
   sync engine, downloads                    │                    sessions, highlights
   share extension, widget                   ├─ Inbox scan (every minute)
                                             └─ Open Library lookups (every 5 minutes)
```

- **Server** (`src/`): a Hono API on `127.0.0.1`, published to a private tailnet with Tailscale Serve. It has no authentication of its own, so it belongs on a private network. Modules are split by job: `catalog/` and `store/` (the database), `files/` and `epub/` (adding books, reading EPUB metadata), `covers/`, `lookup/` and `enrich/` (Open Library), `sync/`, and `server/` (routes, request validation, Range requests). `src/shared/api.ts` defines the JSON both sides speak.
- **StacksKit** (`app/StacksKit/`): a Swift package with everything that doesn't need UIKit: models, API client, local store, sync engine, download planning, session timing, the reading-habit math and theme tokens. It is tested on its own with `swift test`.
- **Apps** (`app/`): the SwiftUI app (iOS, iPadOS and Mac Catalyst) with Readium for rendering, the share extension, and the WidgetKit widget. The widget never talks to the server; the app writes a summary and covers into a shared app-group container.
- **Contract tests.** The server tests write real responses into `app-fixtures/`, and the Swift tests decode them, so the two sides can't drift apart silently.
- **History.** Book data first lived in a Grimoire notes graph, one page per book ([docs/title-page-format.md](docs/title-page-format.md)). It moved into the server's own database; `src/grimoire/` and the scripts under `scripts/` remain for the one-time import and for reference.

## Tech stack

Server: TypeScript run directly by Node 26 (type stripping, no build step), Hono, `node:sqlite`, fflate and fast-xml-parser for EPUBs, Vitest. Apps: Swift 6, SwiftUI, WidgetKit, Readium Swift Toolkit 3.11, GRDB 7.11, XcodeGen. Hosting: zsh scripts, launchd and Tailscale Serve on a macOS server.

## Getting started

Requirements: Node 26 or newer, pnpm, and for the apps Xcode with Swift 6 and the iOS 18 SDK plus [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
pnpm install
cp .env.example .env     # every value is optional; see the comments in the file
```

| Variable | Used by | Meaning |
|---|---|---|
| `STACKS_SERVER_URL` | `app/generate-project.sh` | Default server URL baked into the apps (Settings can change it) |
| `STACKS_DEPLOY_HOST` | `ops/deploy.sh` | ssh host of the server machine |
| `STACKS_TZ` | `ops/run.sh` | Server time zone for reading-log days (default UTC) |
| `STACKS_DB` | server | Database path (default `~/Library/Application Support/stacks/stacks.db`) |
| `PORT`, `STACKS_HOME` | `pnpm serve` | Port (default 8782) and folder for book files, covers and the Inbox (default `~/Stacks`) |
| `GRIMOIRE_GRAPH`, `GRIM_BIN` | import, Grimoire tests | Grimoire graph folder and `grim` CLI path |
| `STACKS_BACKUP_DIR` | `ops/backup.sh` | Where the nightly backup goes (default `~/StacksBackup`) |

### Run the server

```sh
pnpm serve               # http://127.0.0.1:8782; GET /api/health to check
```

`pnpm serve` reads settings from the environment, not from `.env`; export them first or use `node --env-file=.env src/server/main.ts`.

### Build the apps

```sh
cd app
./generate-project.sh    # writes Stacks.xcodeproj from project.yml (not committed)
open Stacks.xcodeproj    # run the Stacks scheme on a simulator, a device or "My Mac (Mac Catalyst)"
```

The project's signing team (`DEVELOPMENT_TEAM` in `app/project.yml`) and app-group IDs are the author's; change them to your own team to sign a build.

### Deploy to a Mac server

`ops/deploy.sh`, run from your Mac, runs the tests and type check, rsyncs the server code and `.env` to `STACKS_DEPLOY_HOST`, installs production dependencies there, installs or restarts two launchd agents (the server via `ops/run.sh`, and a 03:30 nightly backup via `ops/backup.sh`), and publishes the API on the tailnet: HTTPS on port 8450, plus plain TCP on 8451 for a Mac with Tailscale DNS off. The backup copies the book files and covers and takes a consistent SQLite backup of the database.

## Tests

```sh
pnpm test                                   # Vitest: 295 tests in 32 files
pnpm typecheck                              # tsc --noEmit
cd app/StacksKit && swift test              # Swift Testing: 96 tests in 9 suites
```

The server tests cover the API routes and request validation, Range requests, the database and sync, the catalog and editor, EPUB parsing (on EPUBs built in the test), covers, the Inbox, Open Library matching, and the import scripts' planning. The Swift tests cover the models against `app-fixtures/`, the API client, library filters and sorting, the local store, the sync engine, download planning, session timing, reading-habit streaks across daylight-saving changes, deep links and the widget summary. Three Grimoire test files create throwaway graphs through the `grim` CLI and need it installed; they never touch a real graph.

## Project layout

```
src/            server: catalog, store, files, epub, covers, lookup, enrich, sync, server, shared
test/fixtures/  test helpers (an EPUB builder and a sample cover)
app-fixtures/   JSON written by the server tests and decoded by the Swift tests
app/
  StacksKit/    Swift package: models, API client, local store, sync, downloads, habit math
  Stacks/       SwiftUI app: library, book page, reader, settings, fonts, assets
  StacksShare/  share extension ("Open in Stacks")
  StacksWidget/ home-screen reading widget
  icons/stacks/ app icon in every platform's format
  project.yml   XcodeGen spec; generate-project.sh turns it into the Xcode project
scripts/        one-off imports: Apple Books library and annotations, Grimoire pages, catalog copy
ops/            deploy, launchd service and nightly backup
skills/stacks/  assistant skill, written for the earlier Grimoire-page format
docs/           the old Grimoire book-page format
CLAUDE.md       working notes for AI-assisted development in this repo
```

## License

See [LICENSE](LICENSE).
