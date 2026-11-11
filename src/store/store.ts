// The only code that runs SQL against Stacks' database (node:sqlite).

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Annotation, Format, LookupState, Position, Session, SyncResponse } from '../shared/api.ts'
import type { Status, Title } from '../shared/title.ts'
import { SCHEMA, SCHEMA_VERSION } from './schema.ts'

export interface BookRow {
  bookId: string
  /** The book's Grimoire page id: the link to Grimoire, stable across renames. */
  pageId: string
  format: Format
  fileSha256: string
  fileSize: number
  originalName: string
  isbn: string | null
  publisher: string | null
  language: string | null
  pageCount: number | null
  olWork: string | null
  olEdition: string | null
  cover: 'embedded' | 'openlibrary' | 'generated'
  appleBooksId: string | null
  addedAt: number
  lookupState: LookupState
  lookupTriedAt: number | null
}

const BOOK_COLUMNS: [keyof BookRow, string][] = [
  ['bookId', 'book_id'], ['pageId', 'page_id'], ['format', 'format'], ['fileSha256', 'file_sha256'],
  ['fileSize', 'file_size'], ['originalName', 'original_name'], ['isbn', 'isbn'], ['publisher', 'publisher'],
  ['language', 'language'], ['pageCount', 'page_count'], ['olWork', 'ol_work'], ['olEdition', 'ol_edition'],
  ['cover', 'cover'], ['appleBooksId', 'apple_books_id'], ['addedAt', 'added_at'],
  ['lookupState', 'lookup_state'], ['lookupTriedAt', 'lookup_tried_at'],
]
const BOOK_COLUMN = new Map(BOOK_COLUMNS)

type Row = Record<string, SQLInputValue>

function toBook(r: Row): BookRow {
  const out: Record<string, unknown> = {}
  for (const [key, col] of BOOK_COLUMNS) out[key] = r[col] ?? null
  return out as unknown as BookRow
}

function toTitle(r: Row, tags: string[]): Title {
  const t: Title = {
    pageId: r.page_id as string, pageTitle: r.page_title as string, name: r.name as string, type: 'book',
    status: r.status as Status, tags, notesText: '', updatedAt: r.updated_at as number, createdAt: r.created_at as number,
  }
  if (r.rating !== null) t.rating = r.rating as number
  if (r.rec !== null) t.rec = r.rec as string
  if (r.finished !== null) t.finished = r.finished as string
  if (r.progress !== null) t.progress = r.progress as string
  if (r.year !== null) t.year = r.year as number
  if (r.genre !== null) t.genre = JSON.parse(r.genre as string) as string[]
  if (r.summary !== null) t.summary = r.summary as string
  if (r.author !== null) t.author = r.author as string
  if (r.apple_books !== null) t.appleBooks = r.apple_books as string
  return t
}

export type OutboxOp = 'setFields' | 'setTags'
export interface OutboxItem { id: number; bookId: string; op: OutboxOp; payload: unknown; attempts: number }

function toPosition(r: Row): Position {
  return {
    bookId: r.book_id as string, device: r.device as string, locator: JSON.parse(r.locator as string),
    progression: r.progression as number, updatedAt: r.updated_at as number,
  }
}

function toSession(r: Row): Session {
  return {
    sessionId: r.session_id as string, bookId: r.book_id as string, device: r.device as string,
    startedAt: r.started_at as number, endedAt: r.ended_at as number, activeSeconds: r.active_seconds as number,
    startProgression: r.start_progression as number, endProgression: r.end_progression as number,
    pagesTurned: r.pages_turned as number,
  }
}

function toAnnotation(r: Row): Annotation {
  return {
    annotationId: r.annotation_id as string, bookId: r.book_id as string, kind: r.kind as Annotation['kind'],
    color: r.color as Annotation['color'], locator: JSON.parse(r.locator as string), text: r.text as string,
    note: (r.note as string | null) ?? null, createdAt: r.created_at as number, updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null, device: r.device as string, source: r.source as Annotation['source'],
  }
}

export class Store {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
  }

  close(): void {
    this.db.close()
  }

  /** Runs fn in one transaction. */
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** The next change number; call inside a transaction. */
  private nextSeq(): number {
    const r = this.db.prepare('UPDATE counter SET seq = seq + 1 WHERE id = 1 RETURNING seq').get() as { seq: number }
    return r.seq
  }

  currentCursor(): number {
    return (this.db.prepare('SELECT seq FROM counter WHERE id = 1').get() as { seq: number }).seq
  }

  // ---- books ----

  insertBook(row: BookRow): void {
    this.tx(() => {
      const cols = BOOK_COLUMNS.map(([, c]) => c)
      this.db
        .prepare(`INSERT INTO books (${cols.join(', ')}, seq) VALUES (${cols.map(() => '?').join(', ')}, ?)`)
        .run(...BOOK_COLUMNS.map(([k]) => row[k] as SQLInputValue), this.nextSeq())
    })
  }

  getBook(bookId: string): BookRow | null {
    return this.oneBook('book_id', bookId)
  }

  bookBySha(sha: string): BookRow | null {
    return this.oneBook('file_sha256', sha)
  }

  bookByPage(pageId: string): BookRow | null {
    return this.oneBook('page_id', pageId)
  }

  bookByAppleBooksId(id: string): BookRow | null {
    return this.oneBook('apple_books_id', id)
  }

  listBooks(): BookRow[] {
    return (this.db.prepare('SELECT * FROM books ORDER BY added_at, book_id').all() as Row[]).map(toBook)
  }

  updateBook(bookId: string, patch: Partial<Omit<BookRow, 'bookId'>>): void {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof BookRow, unknown][]
    if (entries.length === 0) return
    this.tx(() => {
      const sets = entries.map(([k]) => `${BOOK_COLUMN.get(k)} = ?`)
      this.db
        .prepare(`UPDATE books SET ${sets.join(', ')}, seq = ? WHERE book_id = ?`)
        .run(...entries.map(([, v]) => v as SQLInputValue), this.nextSeq(), bookId)
    })
  }

  /** Only for undoing an add whose file couldn't be written. */
  deleteBook(bookId: string): void {
    this.db.prepare('DELETE FROM books WHERE book_id = ?').run(bookId)
  }

  // ---- positions, sessions, annotations ----

  /** Applied only when it is newer than the stored position for that book and device. */
  putPosition(p: Position): boolean {
    return this.tx(() => {
      const have = this.db.prepare('SELECT updated_at FROM positions WHERE book_id = ? AND device = ?').get(p.bookId, p.device) as
        | { updated_at: number } | undefined
      if (have && have.updated_at >= p.updatedAt) return false
      this.db
        .prepare(`INSERT OR REPLACE INTO positions (book_id, device, locator, progression, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(p.bookId, p.device, JSON.stringify(p.locator), p.progression, p.updatedAt, this.nextSeq())
      return true
    })
  }

  /** New sessions are added; a known one is replaced only when it has grown (a later endedAt). */
  putSession(s: Session): boolean {
    return this.tx(() => {
      const have = this.db.prepare('SELECT ended_at FROM sessions WHERE session_id = ?').get(s.sessionId) as { ended_at: number } | undefined
      if (have && have.ended_at >= s.endedAt) return false
      this.db
        .prepare(`INSERT OR REPLACE INTO sessions (session_id, book_id, device, started_at, ended_at, active_seconds,
          start_progression, end_progression, pages_turned, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(s.sessionId, s.bookId, s.device, s.startedAt, s.endedAt, s.activeSeconds, s.startProgression, s.endProgression,
          s.pagesTurned, this.nextSeq())
      return true
    })
  }

  /** Applied when new or strictly newer, so an equal or older edit from a slow device never wins. */
  putAnnotation(a: Annotation): boolean {
    return this.tx(() => {
      const have = this.db.prepare('SELECT updated_at FROM annotations WHERE annotation_id = ?').get(a.annotationId) as
        | { updated_at: number } | undefined
      if (have && have.updated_at >= a.updatedAt) return false
      this.db
        .prepare(`INSERT OR REPLACE INTO annotations (annotation_id, book_id, kind, color, locator, text, note, created_at,
          updated_at, deleted_at, device, source, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(a.annotationId, a.bookId, a.kind, a.color, JSON.stringify(a.locator), a.text, a.note, a.createdAt, a.updatedAt,
          a.deletedAt, a.device, a.source, this.nextSeq())
      return true
    })
  }

  /** Every position, session and annotation written after the cursor. */
  changesSince(cursor: number): SyncResponse {
    // A cursor ahead of the store (the database was restored from a backup) means the device has to start over.
    const from = cursor > this.currentCursor() ? 0 : cursor
    const positions = this.db.prepare('SELECT * FROM positions WHERE seq > ? ORDER BY seq').all(from) as Row[]
    const sessions = this.db.prepare('SELECT * FROM sessions WHERE seq > ? ORDER BY seq').all(from) as Row[]
    const annotations = this.db.prepare('SELECT * FROM annotations WHERE seq > ? ORDER BY seq').all(from) as Row[]
    // Synchronous, so nothing is written between the reads above and this one.
    return {
      cursor: Math.max(from, this.currentCursor()),
      positions: positions.map(toPosition),
      sessions: sessions.map(toSession),
      annotations: annotations.map(toAnnotation),
    }
  }

  positionsFor(bookId: string): Position[] {
    return (this.db.prepare('SELECT * FROM positions WHERE book_id = ? ORDER BY device').all(bookId) as Row[]).map(toPosition)
  }

  annotationsFor(bookId: string): Annotation[] {
    return (this.db.prepare('SELECT * FROM annotations WHERE book_id = ? ORDER BY created_at').all(bookId) as Row[]).map(toAnnotation)
  }

  sessionsBetween(from: number, to: number): Session[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at').all(from, to) as Row[])
      .map(toSession)
  }

  lastReadAt(bookId: string): number | null {
    const r = this.db.prepare('SELECT MAX(updated_at) AS t FROM positions WHERE book_id = ?').get(bookId) as { t: number | null }
    return r.t ?? null
  }

  // ---- catalog: each book's status, rating, tags and looked-up details ----

  catalogTitles(): Title[] {
    const tags = new Map<string, string[]>()
    for (const r of this.db.prepare('SELECT page_id, tag FROM title_tags ORDER BY rowid').all() as Row[]) {
      const list = tags.get(r.page_id as string) ?? []
      list.push(r.tag as string)
      tags.set(r.page_id as string, list)
    }
    return (this.db.prepare('SELECT * FROM titles ORDER BY created_at, page_id').all() as Row[]).map((r) => toTitle(r, tags.get(r.page_id as string) ?? []))
  }

  catalogTitle(pageId: string): Title | null {
    return this.catalogTitles().find((t) => t.pageId === pageId) ?? null
  }

  /** Inserts or replaces a title and its tags. */
  catalogPut(t: Title): void {
    this.tx(() => {
      this.db
        .prepare(`INSERT OR REPLACE INTO titles (page_id, page_title, name, status, rating, rec, finished, progress, year, genre,
          summary, author, apple_books, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(t.pageId, t.pageTitle, t.name, t.status, t.rating ?? null, t.rec ?? null, t.finished ?? null, t.progress ?? null,
          t.year ?? null, t.genre ? JSON.stringify(t.genre) : null, t.summary ?? null, t.author ?? null, t.appleBooks ?? null,
          t.createdAt, t.updatedAt)
      this.db.prepare('DELETE FROM title_tags WHERE page_id = ?').run(t.pageId)
      for (const tag of t.tags) this.db.prepare('INSERT OR IGNORE INTO title_tags (page_id, tag) VALUES (?, ?)').run(t.pageId, tag)
    })
  }

  /** Every tag in use with its book count, plus tags that only have a group. */
  catalogTags(): { title: string; group?: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const r of this.db.prepare('SELECT tag, COUNT(*) AS n FROM title_tags GROUP BY tag').all() as Row[]) counts.set(r.tag as string, r.n as number)
    const groups = new Map((this.db.prepare('SELECT tag, group_name FROM tag_groups').all() as Row[]).map((r) => [r.tag as string, r.group_name as string]))
    const names = new Set([...counts.keys(), ...groups.keys()])
    return [...names].sort().map((title) => {
      const group = groups.get(title)
      return group ? { title, group, count: counts.get(title) ?? 0 } : { title, count: counts.get(title) ?? 0 }
    })
  }

  catalogSetTagGroup(tag: string, group: string | null): void {
    if (group === null) this.db.prepare('DELETE FROM tag_groups WHERE tag = ?').run(tag)
    else this.db.prepare('INSERT OR REPLACE INTO tag_groups (tag, group_name) VALUES (?, ?)').run(tag, group)
  }

  // ---- Grimoire outbox ----

  enqueueGrimoire(bookId: string, op: OutboxOp, payload: unknown, now: number): void {
    this.db.prepare('INSERT INTO grimoire_outbox (book_id, op, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(bookId, op, JSON.stringify(payload), now)
  }

  pendingGrimoire(): OutboxItem[] {
    return (this.db.prepare('SELECT * FROM grimoire_outbox ORDER BY id').all() as Row[]).map((r) => ({
      id: r.id as number,
      bookId: r.book_id as string,
      op: r.op as OutboxOp,
      payload: JSON.parse(r.payload as string) as unknown,
      attempts: r.attempts as number,
    }))
  }

  finishGrimoire(id: number): void {
    this.db.prepare('DELETE FROM grimoire_outbox WHERE id = ?').run(id)
  }

  failGrimoire(id: number, error: string): void {
    this.db.prepare('UPDATE grimoire_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(error, id)
  }

  hasPendingGrimoire(bookId: string): boolean {
    return this.db.prepare('SELECT 1 FROM grimoire_outbox WHERE book_id = ? LIMIT 1').get(bookId) !== undefined
  }

  // ---- progress written to Grimoire ----

  progressWrite(bookId: string): { day: string; percent: number } | null {
    const r = this.db.prepare('SELECT day, percent FROM progress_writes WHERE book_id = ?').get(bookId) as
      | { day: string; percent: number } | undefined
    return r ? { day: r.day, percent: r.percent } : null
  }

  setProgressWrite(bookId: string, day: string, percent: number): void {
    this.db.prepare('INSERT OR REPLACE INTO progress_writes (book_id, day, percent) VALUES (?, ?, ?)').run(bookId, day, percent)
  }

  private oneBook(col: string, value: string): BookRow | null {
    const r = this.db.prepare(`SELECT * FROM books WHERE ${col} = ? LIMIT 1`).get(value) as Row | undefined
    return r ? toBook(r) : null
  }
}
