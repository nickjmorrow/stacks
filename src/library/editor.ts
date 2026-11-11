// Changes to a book's Grimoire page made from the app. When grim fails, the change waits in the
// store's outbox and is retried in order, so the app never loses an edit to a busy Grimoire.

import { GrimError } from '../grimoire/grim.ts'
import { NotFoundError, type Grimoire, type SetFieldsOptions } from '../grimoire/grimoire.ts'
import type { FieldKey } from '../shared/title.ts'
import type { Store } from '../store/store.ts'

/** What Stacks needs from Grimoire; the real adapter satisfies it and tests pass a fake. */
export type GrimoirePort = Pick<Grimoire, 'listTitles' | 'getTitle' | 'listTags' | 'setFields' | 'setTags' | 'createTitle' | 'pageKind'>

/** The fields the app and the reader may change. */
export type EditableField = 'status' | 'rating' | 'rec' | 'finished' | 'progress'
export type EditableFields = Partial<Record<EditableField, string | null>>

interface SetFieldsPayload { fields: EditableFields; opts: SetFieldsOptions }

export class BookEditor {
  private readonly grimoire: GrimoirePort
  private readonly store: Store
  private readonly now: () => number
  /** The last write started for each book; the next one waits for it, so edits land in order. */
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(deps: { grimoire: GrimoirePort; store: Store; now: () => number }) {
    this.grimoire = deps.grimoire
    this.store = deps.store
    this.now = deps.now
  }

  async setFields(bookId: string, fields: EditableFields, opts: SetFieldsOptions = {}): Promise<{ pending: boolean }> {
    const payload: SetFieldsPayload = { fields, opts }
    return this.write(bookId, 'setFields', payload, (pageId) => this.grimoire.setFields(pageId, fields as Partial<Record<FieldKey, string | null>>, opts))
  }

  async setTags(bookId: string, tags: string[]): Promise<{ pending: boolean }> {
    return this.write(bookId, 'setTags', tags, (pageId) => this.grimoire.setTags(pageId, tags))
  }

  /** Sends queued edits in order. A book whose edit fails keeps the rest of its edits queued. Returns how many were written. */
  async retryOutbox(): Promise<number> {
    let written = 0
    const stuck = new Set<string>()
    for (const item of this.store.pendingGrimoire()) {
      if (stuck.has(item.bookId)) continue
      const book = this.store.getBook(item.bookId)
      if (!book) {
        this.store.finishGrimoire(item.id)
        continue
      }
      try {
        if (item.op === 'setFields') {
          const { fields, opts } = item.payload as SetFieldsPayload
          await this.grimoire.setFields(book.pageId, fields as Partial<Record<FieldKey, string | null>>, opts)
        } else {
          await this.grimoire.setTags(book.pageId, item.payload as string[])
        }
        this.store.finishGrimoire(item.id)
        written++
      } catch (err) {
        stuck.add(item.bookId)
        if (err instanceof NotFoundError) this.store.finishGrimoire(item.id)
        else this.store.failGrimoire(item.id, err instanceof Error ? err.message : String(err))
      }
    }
    return written
  }

  private write(bookId: string, op: 'setFields' | 'setTags', payload: unknown, run: (pageId: string) => Promise<unknown>): Promise<{ pending: boolean }> {
    const book = this.store.getBook(bookId)
    if (!book) return Promise.reject(new NotFoundError(`no book ${bookId}`))
    const before = this.inFlight.get(bookId) ?? Promise.resolve()
    const next = before.catch(() => {}).then(() => this.writeNow(bookId, book.pageId, op, payload, run))
    this.inFlight.set(bookId, next)
    void next.catch(() => {}).finally(() => {
      if (this.inFlight.get(bookId) === next) this.inFlight.delete(bookId)
    })
    return next
  }

  private async writeNow(bookId: string, pageId: string, op: 'setFields' | 'setTags', payload: unknown, run: (pageId: string) => Promise<unknown>): Promise<{ pending: boolean }> {
    if (this.store.hasPendingGrimoire(bookId)) {
      this.store.enqueueGrimoire(bookId, op, payload, this.now())
      return { pending: true }
    }
    try {
      await run(pageId)
      return { pending: false }
    } catch (err) {
      if (!(err instanceof GrimError)) throw err
      this.store.enqueueGrimoire(bookId, op, payload, this.now())
      return { pending: true }
    }
  }
}
