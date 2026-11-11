// The library: each book with a file, joining its catalog entry (what the owner thinks) with
// Stacks' row (the file and looked-up extras). Edits still waiting in the outbox are shown as made.

import type { LibraryBook, LibraryResponse } from '../shared/api.ts'
import type { Title } from '../shared/title.ts'
import type { BookRow, OutboxItem, Store } from '../store/store.ts'
import type { EditableFields, GrimoirePort } from './editor.ts'

export async function listLibrary(grimoire: GrimoirePort, store: Store): Promise<LibraryResponse> {
  const cursor = store.currentCursor()
  const [titles, tags] = await Promise.all([grimoire.listTitles(), grimoire.listTags()])
  const byPage = new Map(titles.map((t) => [t.pageId, t]))
  const pending = new Map<string, OutboxItem[]>()
  for (const item of store.pendingGrimoire()) pending.set(item.bookId, [...(pending.get(item.bookId) ?? []), item])

  const books: LibraryBook[] = []
  for (const row of store.listBooks()) {
    const page = byPage.get(row.pageId)
    if (!page) continue
    books.push(toLibraryBook(row, page, store.lastReadAt(row.bookId), pending.get(row.bookId) ?? []))
  }
  return { books, tags, cursor }
}

export function toLibraryBook(row: BookRow, page: Title, lastReadAt: number | null, pending: OutboxItem[]): LibraryBook {
  const book: LibraryBook = {
    bookId: row.bookId,
    pageId: page.pageId,
    pageTitle: page.pageTitle,
    name: page.name,
    status: page.status,
    tags: page.tags,
    format: row.format,
    fileSize: row.fileSize,
    fileSha256: row.fileSha256,
    coverUrl: row.cover === 'generated' ? null : `/api/books/${row.bookId}/cover`,
    addedAt: row.addedAt,
    lookupState: row.lookupState,
    lastReadAt,
    pendingEdit: pending.length > 0,
  }
  for (const key of ['rating', 'rec', 'finished', 'progress', 'year', 'genre', 'summary', 'author'] as const) {
    if (page[key] !== undefined) (book as unknown as Record<string, unknown>)[key] = page[key]
  }
  if (row.isbn) book.isbn = row.isbn
  if (row.appleBooksId) book.appleBooksId = row.appleBooksId
  for (const item of pending) applyPending(book, item)
  return book
}

function applyPending(book: LibraryBook, item: OutboxItem): void {
  if (item.op === 'setTags') {
    book.tags = item.payload as string[]
    return
  }
  const { fields } = item.payload as { fields: EditableFields }
  const b = book as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete b[key]
    else b[key] = key === 'rating' ? Number(value) : value
  }
}
