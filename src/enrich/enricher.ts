// Fills the looked-up facts on a book's catalog entry (author, year, genre, summary) from Open Library,
// only where it has none, and only when the match is clear. Unclear books wait in "Needs a look".

import { fetchOpenLibraryCover, saveCover } from '../covers/covers.ts'
import { coverPath, type FilesDeps } from '../files/addFile.ts'
import type { GrimoirePort } from '../library/editor.ts'
import { LookupUnavailableError } from '../lookup/lookupError.ts'
import type { OpenLibraryClient } from '../lookup/openLibrary.ts'
import type { LookupResult } from '../lookup/ports.ts'
import type { FieldKey, Title } from '../shared/title.ts'
import type { BookRow, Store } from '../store/store.ts'
import { cleanTitle, lc, sharesAuthor } from '../shared/sameWork.ts'
import { genreFromSubjects } from './genres.ts'
import type { EnricherPort, NeedsLookItem } from './port.ts'

const RETRY_AFTER_MS = 60 * 60 * 1000
const FILLED: readonly FieldKey[] = ['author', 'year', 'genre', 'summary']

type Outcome = 'done' | 'needs_look' | 'failed'

export interface EnricherDeps {
  store: Store
  /** Writes as `me`: these are facts about the book, not Claude's edits. */
  grimoire: GrimoirePort
  lookup: OpenLibraryClient
  files: FilesDeps
  now: () => number
}

/** What to search for: the title without a series note "(Musketeers, Book 2)" or a subtitle. */
export function searchTitle(name: string): string {
  return cleanTitle(name).replace(/\s*\([^)]*\)\s*$/, '').split(/\s*:\s*/)[0]!.trim() || name
}

/** Comparison key for titles: lowercase, accents folded, no punctuation or leading article. */
function titleKey(name: string): string {
  return lc(searchTitle(name)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|a|an) /, '')
}

export class Enricher implements EnricherPort {
  private readonly deps: EnricherDeps
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: EnricherDeps) {
    this.deps = deps
  }

  async runOnce(): Promise<{ done: number; needsLook: number; failed: number }> {
    const counts = { done: 0, needsLook: 0, failed: 0 }
    const due = this.deps.store.listBooks().filter((b) =>
      b.lookupState === 'pending' || (b.lookupState === 'failed' && (b.lookupTriedAt ?? 0) <= this.deps.now() - RETRY_AFTER_MS))
    for (const book of due) {
      const outcome = await this.serial(() => this.enrich(book.bookId))
      if (outcome === 'done') counts.done++
      else if (outcome === 'needs_look') counts.needsLook++
      else if (outcome === 'failed') counts.failed++
    }
    return counts
  }

  enrichSoon(bookId: string): void {
    void this.serial(() => this.enrich(bookId)).catch((err) => console.error(`lookup of ${bookId} failed:`, err))
  }

  /** Resolves when queued lookups have finished (for tests and shutdown). */
  async idle(): Promise<void> {
    await this.queue.catch(() => {})
  }

  async needsLook(): Promise<NeedsLookItem[]> {
    const titles = new Map((await this.deps.grimoire.listTitles()).map((t) => [t.pageId, t]))
    const out: NeedsLookItem[] = []
    for (const book of this.deps.store.listBooks()) {
      const page = titles.get(book.pageId)
      if (book.lookupState !== 'needs_look' || !page) continue
      let candidates: LookupResult[] = []
      try {
        candidates = await this.deps.lookup.searchBook(searchTitle(page.name), page.author)
        if (candidates.length === 0 && page.author) candidates = await this.deps.lookup.searchBook(searchTitle(page.name))
      } catch (err) {
        if (!(err instanceof LookupUnavailableError)) throw err
      }
      out.push({ bookId: book.bookId, pageTitle: page.pageTitle, candidates })
    }
    return out
  }

  async match(bookId: string, workId: string): Promise<void> {
    await this.serial(async () => {
      const book = this.deps.store.getBook(bookId)
      const page = book && (await this.deps.grimoire.getTitle(book.pageId))
      if (!book || !page) return
      await this.apply(book, page, workId)
    })
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => {})
    return next
  }

  private async enrich(bookId: string): Promise<Outcome | null> {
    const { store, grimoire, lookup, now } = this.deps
    const book = store.getBook(bookId)
    if (!book) return null
    const page = await grimoire.getTitle(book.pageId)
    if (!page) return null
    try {
      const edition = book.isbn ? await lookup.byIsbn(book.isbn) : null
      if (edition) {
        store.updateBook(bookId, {
          olEdition: edition.editionId,
          pageCount: book.pageCount ?? edition.pageCount ?? null,
          publisher: book.publisher ?? edition.publisher ?? null,
        })
        await this.apply(store.getBook(bookId)!, page, edition.workId)
        return 'done'
      }
      const results = await lookup.searchBook(searchTitle(page.name), page.author)
      const want = titleKey(page.name)
      const same = results.filter((r) => titleKey(r.name) === want && (!page.author || sharesAuthor(r.detail, page.author)))
      // With the author known, several same-title works are usually duplicates in Open Library: take its top match.
      if (same.length === 1 || (page.author && same.length > 1)) {
        await this.apply(book, page, same[0]!.id)
        return 'done'
      }
      store.updateBook(bookId, { lookupState: 'needs_look', lookupTriedAt: now() })
      return 'needs_look'
    } catch (err) {
      if (!(err instanceof LookupUnavailableError)) throw err
      store.updateBook(bookId, { lookupState: 'failed', lookupTriedAt: now() })
      return 'failed'
    }
  }

  /** Fills blank facts from the work, records it, and fetches a cover if the book has none. */
  private async apply(book: BookRow, page: Title, workId: string): Promise<void> {
    const { store, grimoire, lookup, files, now } = this.deps
    const { fields, subjects } = await lookup.work(workId)
    const genre = genreFromSubjects(subjects)
    if (genre) fields.genre = genre
    const fill: Partial<Record<FieldKey, string>> = {}
    for (const key of FILLED) {
      const value = fields[key]
      if (value && page[key as keyof Title] === undefined) fill[key] = value
    }
    if (Object.keys(fill).length > 0) await grimoire.setFields(page.pageId, fill)

    let cover = book.cover
    if (cover === 'generated' && book.isbn) {
      const bytes = await fetchOpenLibraryCover(book.isbn, files.fetch)
      if (bytes) {
        try {
          await saveCover(bytes, coverPath(files.home, book.bookId))
          cover = 'openlibrary'
        } catch {
          // keep the generated cover
        }
      }
    }
    store.updateBook(book.bookId, { olWork: workId, cover, lookupState: 'done', lookupTriedAt: now() })
  }
}
