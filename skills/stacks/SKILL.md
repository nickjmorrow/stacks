---
name: stacks
description: "How to add, rate, tag, finish and suggest books in the user's Grimoire book pages, the format the Stacks books app reads. Use when the user says 'add X to my reading list', 'I finished X', 'rate X', 'tag X', asks 'what should I read', or names a book to track. Movies, shows and games use the hoard skill."
trigger: "adding, rating, tagging, finishing or suggesting books"
---

# Books

Each book is one Grimoire page. The Stacks app reads these pages; nothing else stores what the user thinks about a book. Movies, shows and games use the same page format but belong to the **hoard** skill: never change a page whose `type` is not `book`. Load the **grimoire** skill too for the tool basics.

The format is defined in `docs/title-page-format.md` in the Stacks repo. In Claude Code, read it if unsure. On the phone (no file access) this summary is enough.

## Rules

- Never name the app inside Grimoire: no page, property or note mentions it.
- Never edit the old list page `books`.
- One page per work. Never make a second page for a title that has one.
- A same-name page with a different year is a different work. A same-name page that is a movie or show ("Hollow Hill") is a different work too: name the book page `Title (book)`.
- A book page holds single facts and the user's opinion (status, rating, tags, rec, author, year, genre, summary, the user's own notes). Never add lists of things to it: highlights, margin notes, reading sessions and positions live in the books app's own database, not in Grimoire.

## Adding a title

1. `grimoire_search` for the title. If a page exists, edit it (next section); don't create one.
2. Otherwise `grimoire_append` to a page named `Title (Year)`, or `Title` when the year is unknown (appending creates the page), with one block of these lines and nothing else:

```
- tags:: [[media]], [[Gothic]]
  type:: book
  status:: want
  rec:: Claude
```

- `tags`: `[[media]]` first, then any tags, each as `[[Full Tag Name]]`.
- `type`: always `book`.
- `status`: `want` (to read), `doing` (reading), `done` (read) or `dropped` (gave up).
- `rec`: who recommended it (`Alice`, `Omar`); `Claude` if you did.

Add `author` when you know it for sure. Leave out `year`, `genre`, `summary` and `apple-books`: Stacks will fill them. Its lookup isn't running yet, so they stay blank for now; don't fill them in by hand. Don't write them yourself.

## Editing an existing title

The properties live in the page's first top-level block; every other block is a note or review. `grimoire_get_page` first, then `grimoire_edit_block` on that first block with the same text, changing only the one line. Keep every other line byte-identical, including keys you don't know (such as `why::`). Add a new tag by adding `, [[Tag]]` to the `tags` line.

What you may set:
- `tags`, `type`, `status`, `rec`: any time the user asks.
- `rating` (whole number 1 to 5): only when the user gives a rating.
- `finished` (`YYYY-MM-DD`) with `status:: done`: only when the user says they finished it. Use today's date unless they give one.
- `progress` (free text like `ch 12`): only when the user says where they are.

If the first block has no `key::` lines (it is prose, like a notes page for a book), don't edit the prose. Append the property block with `grimoire_append`, then move it to the top of the page with `grimoire_move_block` (check its arguments first). Edit that block from then on.

Reviews and thoughts go in a new block under the first one with `grimoire_append`, in the user's words.

## Tags

- Full names that read on their own: `Read with Alice`, never `Alice`, so a tag never lands on a person's page.
- Reuse existing tags; tag groups are shared with movies and shows. Tags without a group show under Other.
- A new tag's group is one line on that tag's own page, `group:: Vibe`. Add it only if the user asks.

## Suggesting

1. Find what the user has: `grimoire_query` for pages whose first block has `type:: book` and tags including `[[media]]`. Read `status`, `rating`, `author` and tags.
2. Don't suggest anything already there. Lean on what they rated 4 or 5 and their tags.
3. Recommend outward-facing picks (why it's good, who wrote it), a few at a time. Ask what mood or kind of book they want if unclear, with a default.
4. Add a pick only when the user says so: a `want` page with `rec:: Claude`.

## Older forms

Old pages may use `#Tag` tags, `to read` or `read` status words, or `5/5` ratings. Don't convert them. Only touch the one line you're changing, and write the plain form (`status:: done`, `rating:: 5`) on that line.
