// Adding a book file to Stacks: keep the file, read what it says about itself, save a cover, and
// link it to the book's Grimoire page (finding or creating the page through the type guard).

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fetchOpenLibraryCover, saveCover } from '../covers/covers.ts'
import { readEpubMetadata, type EpubMetadata } from '../epub/metadata.ts'
import type { GrimoirePort } from '../library/editor.ts'
import type { FetchLike } from '../lookup/lookupError.ts'
import type { Format } from '../shared/api.ts'
import { mainTitle, sameWork } from '../shared/sameWork.ts'
import type { Title } from '../shared/title.ts'
import type { BookRow, Store } from '../store/store.ts'

export interface FilesDeps {
  store: Store
  grimoire: GrimoirePort
  /** STACKS_HOME: files/, covers/ and Inbox/ live here. */
  home: string
  fetch: FetchLike
  now: () => number
  /** Called with each newly added book, without waiting (the server starts a lookup). */
  onAdded?: (bookId: string) => void
}

export class UnsupportedFileError extends Error {
  override name = 'UnsupportedFileError'
}

export class NoPageError extends Error {
  override name = 'NoPageError'
}

/** The book's page already has a file in Stacks (another edition, or the EPUB and the PDF of one book). */
export class PageTakenError extends Error {
  override name = 'PageTakenError'
}

export function filePath(home: string, row: Pick<BookRow, 'bookId' | 'format'>): string {
  return join(home, 'files', `${row.bookId}.${row.format}`)
}

export function coverPath(home: string, bookId: string): string {
  return join(home, 'covers', `${bookId}.jpg`)
}

function formatOf(bytes: Uint8Array): Format {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'epub'
  if (Buffer.from(bytes.subarray(0, 4)).toString('latin1') === '%PDF') return 'pdf'
  throw new UnsupportedFileError('not an EPUB or PDF')
}

/** "Title_ Subtitle.pdf" → "Title: Subtitle" (file systems can't hold a colon, so tools write "_ "). */
export function nameFromFile(originalName: string): string {
  const stem = originalName.slice(0, originalName.length - extname(originalName).length)
  return stem.replace(/_ /g, ': ').replace(/\s+/g, ' ').trim()
}

export async function addFile(
  deps: FilesDeps,
  input: { bytes: Uint8Array; originalName: string; appleBooksId?: string; createPage?: boolean },
): Promise<{ bookId: string; created: boolean; pageTitle: string }> {
  const { store, grimoire, home } = deps
  const sha = createHash('sha256').update(input.bytes).digest('hex')
  const existing = store.bookBySha(sha)
  if (existing) {
    const page = (await grimoire.listTitles()).find((t) => t.pageId === existing.pageId)
    return { bookId: existing.bookId, created: false, pageTitle: page?.pageTitle ?? '' }
  }

  const format = formatOf(input.bytes)
  const md: EpubMetadata = format === 'epub' ? readEpubMetadata(input.bytes) : { authors: [] }
  const page = await findOrCreatePage(grimoire, input, md)

  // Checked again right before writing (synchronously, so nothing interleaves): the same file may have
  // been added meanwhile (a retried upload, the Inbox), or this book may already have a file.
  const again = store.bookBySha(sha)
  if (again) return { bookId: again.bookId, created: false, pageTitle: page.pageTitle }
  if (store.bookByPage(page.pageId)) throw new PageTakenError(`${page.pageTitle} already has a file in Stacks`)

  const bookId = randomUUID()
  store.insertBook({
    bookId, pageId: page.pageId, format, fileSha256: sha, fileSize: input.bytes.length, originalName: input.originalName,
    isbn: md.isbn ?? null, publisher: md.publisher ?? null, language: md.language ?? null, pageCount: null,
    olWork: null, olEdition: null, cover: 'generated', appleBooksId: input.appleBooksId ?? null, addedAt: deps.now(),
    lookupState: 'pending', lookupTriedAt: null,
  })
  try {
    mkdirSync(join(home, 'files'), { recursive: true })
    writeFileSync(filePath(home, { bookId, format }), input.bytes)
  } catch (err) {
    store.deleteBook(bookId)
    throw err
  }

  let cover: BookRow['cover'] = 'generated'
  if (md.cover && (await trySave(md.cover.bytes, coverPath(home, bookId)))) cover = 'embedded'
  else if (md.isbn) {
    const ol = await fetchOpenLibraryCover(md.isbn, deps.fetch)
    if (ol && (await trySave(ol, coverPath(home, bookId)))) cover = 'openlibrary'
  }
  if (cover !== 'generated') store.updateBook(bookId, { cover })
  deps.onAdded?.(bookId)
  return { bookId, created: true, pageTitle: page.pageTitle }
}

async function findOrCreatePage(
  grimoire: GrimoirePort,
  input: { originalName: string; appleBooksId?: string; createPage?: boolean },
  md: EpubMetadata,
): Promise<Title> {
  if (input.appleBooksId) {
    const page = (await grimoire.listTitles()).find((t) => t.appleBooks === input.appleBooksId)
    if (page) return page
  }
  if (input.createPage === false) throw new NoPageError(`no book page for ${input.appleBooksId ?? input.originalName}`)
  const name = md.title ?? nameFromFile(input.originalName)
  const author = md.authors[0]

  // A book that already has a page (perhaps "Dune (1965)", or with another subtitle) keeps it, unchanged.
  const titles = await grimoire.listTitles()
  const same = author
    ? titles.filter((t) => sameWork(t.name, t.author, name, author))
    : titles.filter((t) => mainTitle(t.name) === mainTitle(name) && !t.author)
  if (same.length === 1) return same[0]!

  // Never turn one of the owner's own pages (notes on an idea, a person, another app's title) into a book page.
  const fields: Record<string, string> = {}
  if (author) fields.author = author
  if (input.appleBooksId) fields['apple-books'] = input.appleBooksId
  const pageName = (await grimoire.pageKind(name)) === 'none' ? name : `${name} (book)`
  return grimoire.createTitle({ name: pageName, type: 'book', fields, tags: [] })
}

async function trySave(bytes: Uint8Array, out: string): Promise<boolean> {
  try {
    await saveCover(bytes, out)
    return true
  } catch {
    return false
  }
}
