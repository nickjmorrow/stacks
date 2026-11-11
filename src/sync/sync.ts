// A device's sync: store what it sends, answer with what changed since its cursor, and update
// the book's Grimoire page where reading implies it (to read → reading once the reader is 3% in; a daily progress note).

import type { SyncRequest, SyncResponse } from '../shared/api.ts'
import type { BookEditor } from '../library/editor.ts'
import type { Store } from '../store/store.ts'

/** How far into a book a new position must be before a to-read book becomes one being read (opening it isn't reading it). */
export const READING_FROM = 0.03

/** The device name the Apple Books import uses. */
export const IMPORT_DEVICE = 'apple-books'

export interface SyncDeps {
  store: Store
  editor: BookEditor
  now: () => number
  /** For "once a day"; defaults to the server's own time zone. */
  timeZone?: string
}

export async function applySync(deps: SyncDeps, req: SyncRequest): Promise<SyncResponse> {
  const { store } = deps
  const known = (bookId: string) => store.getBook(bookId) !== null

  const reading = new Set<string>()
  for (const p of req.positions) {
    if (!known(p.bookId)) continue
    if (store.putPosition(p) && p.progression >= READING_FROM) reading.add(p.bookId)
  }
  for (const s of req.sessions) if (known(s.bookId)) store.putSession(s)
  for (const a of req.annotations) if (known(a.bookId)) store.putAnnotation(a)

  // Positions imported from Apple Books are history, not reading done here: they change nothing in Grimoire.
  if (req.device === IMPORT_DEVICE) return store.changesSince(req.since)

  for (const bookId of reading) {
    await deps.editor.setFields(bookId, { status: 'doing' }, { onlyIfStatus: ['want'] })
  }
  // Progress is written when the reader closes a book (at most once a day), from where this device stopped.
  const closed = req.closing ? store.positionsFor(req.closing).find((p) => p.device === req.device) : undefined
  if (closed) {
    const today = localDay(deps.now(), deps.timeZone)
    const percent = Math.floor(closed.progression * 100)
    const last = store.progressWrite(closed.bookId)
    if (percent > 0 && !(last && (last.day === today || last.percent === percent))) {
      await deps.editor.setFields(closed.bookId, { progress: `${percent}%` })
      store.setProgressWrite(closed.bookId, today, percent)
    }
  }

  return store.changesSince(req.since)
}

/** YYYY-MM-DD in the given time zone. */
export function localDay(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
}
