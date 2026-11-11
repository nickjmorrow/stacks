# Book page format

**Historical.** Since the catalog moved into Stacks' own database, the server no longer reads or writes these pages. This file describes what `pnpm import-catalog` and the launch-day scripts read from (and once wrote to) the old book pages.

How a book is stored in Grimoire. Stacks, its scripts and Claude (through the `stacks` skill) follow this file. Grimoire itself knows nothing about it: these are ordinary pages, tags and properties.

Hoard (a sibling app for movies, shows and games, with its own copy of this file) uses the same page shape with its own `type` values. Stacks only reads and writes pages with `type:: book`, and never changes a page whose `type` is anything else.

## A book page

```
Frankenstein (1818)
- tags:: [[media]], [[Gothic]]
  type:: book
  status:: want
  rec:: Alice
  author:: Mary Shelley
  year:: 1818
  genre:: Science Fiction
  summary:: A scientist creates a living being and is horrified by it.
  apple-books:: 1000000001
- Notes and reviews go here as ordinary blocks.
```

- **Page name:** `Title (Year)`, or `Title` when the year isn't known. A page that already has a different `type` (a Hoard movie, a person page) is never used for a book; Stacks' scripts then name the book `Title (book)`. An existing notes page for the same book is used as is; never make a second page for the same book.
- **The first top-level block holds the properties,** one `key:: value` per line. Every other block is a note or review.
- **A page is a book** when its first block's `tags` line includes `[[media]]` and it has `type:: book`.

## Properties

| Key | Values | Who sets it |
|---|---|---|
| `tags` | `[[media]]` first, then any tags, as `[[Full Tag Name]]` | anyone |
| `type` | `book` | anyone |
| `status` | `want` (to read), `doing` (reading), `done` (read), `dropped` (gave up) | anyone; the Apple Books import moves it forward from Apple Books' progress |
| `rating` | whole number `1` to `5` | the owner |
| `rec` | who recommended it, e.g. `Alice`, `Omar`, `Claude` | anyone |
| `finished` | date `YYYY-MM-DD`, when status became done | the owner (Stacks will set it once its app exists) |
| `progress` | free text, e.g. `ch 12` | the owner |
| `author` | author name | the Apple Books import; anyone who knows it |
| `year` | year of first publication | Stacks' lookup (Open Library; not running yet) |
| `genre` | comma-separated | Stacks or the old list page |
| `summary` | one sentence | Stacks' lookup (Open Library; not running yet) |
| `apple-books` | Apple Books asset ID | the Apple Books import |

Lines with other keys are left alone.

## Older forms Stacks accepts

Keys in any case (`Status:: to read`), `#Tag` tags, Windows line endings, status words `to read`/`reading`/`read`/`finished`, and ratings like `5/5` or `4.0`. Stacks writes the plain form the next time it changes that line.

## Tags and tag groups

Shared with Hoard. Tags are ordinary Grimoire pages linked from the `tags` line, with full names that read on their own. A tag's group is one line on the tag's own page: `group:: Vibe`. A tag without a group is shown under Other. `[[media]]` is not shown as a tag.
