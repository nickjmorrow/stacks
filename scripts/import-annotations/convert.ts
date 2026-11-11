// Apple Books annotations → Stacks sync records (device "apple-books").

import type { Annotation, Color, Position } from '../../src/shared/api.ts'
import type { AppleAnnotation } from './appleAnnotations.ts'
import { cfiHref, cfiToLocator } from './cfi.ts'

const DEVICE = 'apple-books'
const COLOR_BY_STYLE: Record<number, Color> = { 1: 'green', 2: 'blue', 3: 'yellow', 4: 'pink', 5: 'purple' }

export interface BookInfo {
  bookId: string
  spine: string[]
  /** Apple Books' progress, 0 to 1 */
  progress: number
  /** Started and not finished */
  inProgress: boolean
}

/**
 * Highlights become annotations (a note makes it kind "note"); a highlight whose chapter can't be
 * found keeps an empty href (the app lists it as "not placed"). The last location of a book in
 * progress becomes its position. Annotations for books not in Stacks are left out.
 */
export function toSyncRecords(
  rows: AppleAnnotation[],
  books: Record<string, BookInfo>,
): { annotations: Annotation[]; positions: Position[]; unplaced: string[] } {
  const annotations: Annotation[] = []
  const positions: Position[] = []
  const unplaced: string[] = []
  for (const r of rows) {
    const book = books[r.assetId]
    if (!book) continue
    const id = r.uuid.toLowerCase()
    if (r.type === 'highlight') {
      let locator = cfiToLocator(r.cfi, book.spine, r.text)
      if (!locator) {
        unplaced.push(id)
        locator = { href: '', type: 'application/xhtml+xml', locations: {}, text: { highlight: r.text } }
      }
      annotations.push({
        annotationId: id, bookId: book.bookId, kind: r.note ? 'note' : 'highlight', color: COLOR_BY_STYLE[r.style] ?? 'yellow',
        locator, text: r.text ?? '', note: r.note, createdAt: r.createdAt, updatedAt: Math.max(r.updatedAt, r.createdAt),
        deletedAt: null, device: DEVICE, source: 'apple-books',
      })
    } else if (book.inProgress) {
      const href = cfiHref(r.cfi, book.spine)
      if (!href) continue
      positions.push({
        bookId: book.bookId, device: DEVICE, progression: book.progress, updatedAt: r.updatedAt,
        locator: { href, type: 'application/xhtml+xml', locations: { totalProgression: book.progress } },
      })
    }
  }
  return { annotations, positions, unplaced }
}
