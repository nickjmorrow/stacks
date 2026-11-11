# Stacks

A personal books app: it organizes EPUB and PDF books, combines the owner's notes with looked-up details, and lets them read on iPhone, iPad and Mac. It replaces Apple Books for books the owner has as files. Machine names, deploy targets and other private details are in the gitignored `CLAUDE.local.md`; read it too, along with any local planning notes in `docs/` (gitignored), before designing or changing anything.

This repo is public: tests, fixtures, sample data, docs and comments must be generic, with no personal data (real names, personal media or reading lists, calendars, health, money, machine names).

Split from Hoard (a sibling app for movies, shows and games) on 2026-10-20. Both apps once kept their titles as pages in Grimoire; neither does now (see below).

## Data lives in Stacks (since 2026-11-01)
Everything about a book is tracked solely in Stacks: status, rating, tags (and their groups), who recommended it, finished date, progress and the looked-up author, year, genre and summary. It sits in the catalog tables of Stacks' own database (`src/catalog/`, `src/store/`), next to the files, positions, sessions and highlights.
- The server never reads or writes Grimoire. `Catalog` answers the same calls the Grimoire adapter did (`GrimoirePort`), so the editor, lookups and file adds are unchanged.
- The old book pages in Grimoire are left as they were; nothing syncs to them. `pnpm import-catalog` copied them into the catalog once, on 2026-11-01.
- The Grimoire adapter (`src/grimoire/`) and the launch-day scripts (`migrate`, `import-apple-books`, `merge-pages`, `add-files`) are history; don't run them again against the live data.
- Tag groups were shared with Hoard; Stacks now keeps its own copy (`tag_groups`), and Hoard's are untouched.

## Code
- Node 26 runs TypeScript directly: relative `.ts` imports, erasable syntax only (no enums or parameter properties).
- `pnpm test`, `pnpm typecheck`. Grimoire tests use temporary graphs through `grim` (`~/.local/bin/grim`); never point tests at a real graph.
- Swift: `cd app/StacksKit && swift test` for the package tests.
- Machine-specific values live in the gitignored `.env` (see `.env.example`): read by `app/generate-project.sh` and the `ops/` scripts.

## Build and deploy (after every finished app change)
Build and install on every device, then check the change shows. From `app/`:
```bash
./generate-project.sh
xcodebuild -project Stacks.xcodeproj -scheme Stacks -destination id=<iphone-id> -derivedDataPath build.noindex -allowProvisioningUpdates -configuration Release build > build-device.log 2>&1
xcrun devicectl device install app --device <iphone-id> build.noindex/Build/Products/Release-iphoneos/Stacks.app
xcodebuild -project Stacks.xcodeproj -scheme Stacks -destination "platform=macOS,variant=Mac Catalyst" -derivedDataPath build.noindex -allowProvisioningUpdates -configuration Release build > build-mac.log 2>&1
```
- **iPhone** installs over the network; if it fails with "Failed to connect to remote device", it's locked or asleep: try again, or ask the owner to unlock it.
- **iPad** (id `<ipad-id>`): build and install the same way with that id in place of the iPhone's. If the build says a device isn't registered, add `-allowProvisioningDeviceRegistration`. If it doesn't show as connected, it's locked or asleep: wake it and try again.
- **Mac**: quit Stacks, replace `/Applications/Stacks.app` with `build.noindex/Build/Products/Release-maccatalyst/Stacks.app` (`ditto`), then open it with `open /Applications/Stacks.app` and confirm it stays running (`pgrep -x Stacks`). Launching the binary from a shell isn't a valid test: it inherits the shell's file access.
- **The widget** (`StacksWidget`) is embedded in the iOS app, so the iPhone install above installs it; the Mac build leaves it out. It's added by hand (long-press the home screen, Add Widget, Stacks). To see it in the simulator, build Debug *without* `CODE_SIGNING_ALLOWED=NO`: an unsigned build has no app group, so the widget finds no data.
- **Server changes**: `ops/deploy.sh` from the Mac (launchd job `com.nicholai.stacks` on the server host in `.env`).
- The shell's `log` is a zsh builtin; use `/usr/bin/log show` for system logs.
- Xcode's build output goes to `app/build.noindex`: Spotlight skips folders ending in `.noindex`, so its copies of Stacks.app (some with no icon) don't show up in Spotlight beside the real app.
