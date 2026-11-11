// Sample rows for tests.

import type { BookRow } from './store.ts'

export function bookRow(over: Partial<BookRow> = {}): BookRow {
  return {
    bookId: 'b1', pageId: 'p1', format: 'epub', fileSha256: 'sha1', fileSize: 1234, originalName: 'Dune.epub',
    isbn: '9780441013593', publisher: 'Ace', language: 'en', pageCount: 600, olWork: 'OL1W', olEdition: 'OL1M',
    cover: 'embedded', appleBooksId: 'AB1', addedAt: 1000, lookupState: 'pending', lookupTriedAt: null,
    ...over,
  }
}
