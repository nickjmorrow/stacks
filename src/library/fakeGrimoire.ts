// An in-memory stand-in for the Grimoire adapter, for tests of code above it. Not used by the server.

import { GrimError } from '../grimoire/grim.ts'
import { NotFoundError, TitleConflictError, type TagInfo, type TitleDetail } from '../grimoire/grimoire.ts'
import type { FieldKey, Title } from '../shared/title.ts'
import type { GrimoirePort } from './editor.ts'

export function title(over: Partial<Title> & { pageId: string; pageTitle: string }): Title {
  return {
    name: over.pageTitle.replace(/ \(\d{4}\)$/, ''), type: 'book', status: 'want', tags: [], notesText: '',
    updatedAt: 1, createdAt: 1, ...over,
  }
}

export class FakeGrimoire implements GrimoirePort {
  titles = new Map<string, Title>()
  /** Page names that exist but are another type (a Hoard movie, a person). */
  otherType = new Set<string>()
  /** Page names of the owner's own untyped pages (notes on an idea, a book, anything). */
  plainPages = new Set<string>()
  failing = false
  /** ms each setFields call waits before it runs (to test overlapping edits). */
  delays: number[] = []
  calls: { op: string; pageId: string; arg: unknown }[] = []
  private nextId = 1

  constructor(titles: Title[] = []) {
    for (const t of titles) this.titles.set(t.pageId, t)
  }

  async listTitles(): Promise<Title[]> {
    return [...this.titles.values()]
  }

  async getTitle(pageId: string): Promise<TitleDetail | null> {
    if (this.failing) throw new GrimError('grim timed out')
    const t = this.titles.get(pageId)
    return t ? { ...t, propBlockId: `${pageId}-props`, notes: [] } : null
  }

  async pageKind(name: string): Promise<'none' | 'book' | 'other'> {
    const lower = name.toLowerCase()
    if ([...this.titles.values()].some((t) => t.pageTitle.toLowerCase() === lower)) return 'book'
    if ([...this.otherType, ...this.plainPages].some((p) => p.toLowerCase() === lower)) return 'other'
    return 'none'
  }

  async listTags(): Promise<TagInfo[]> {
    return []
  }

  async setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>, opts: { onlyIfStatus?: Title['status'][] } = {}): Promise<Title> {
    const delay = this.delays.shift()
    if (delay) await new Promise((r) => setTimeout(r, delay))
    if (this.failing) throw new GrimError('grim timed out')
    const t = this.titles.get(pageId)
    if (!t) throw new NotFoundError(pageId)
    this.calls.push({ op: 'setFields', pageId, arg: fields })
    if (opts.onlyIfStatus && !opts.onlyIfStatus.includes(t.status)) return t
    const next: Record<string, unknown> = { ...t }
    for (const [k, v] of Object.entries(fields)) {
      const key = k === 'apple-books' ? 'appleBooks' : k
      if (v === null) delete next[key]
      else next[key] = key === 'rating' || key === 'year' ? Number(v) : key === 'genre' ? v.split(', ') : v
    }
    this.titles.set(pageId, next as unknown as Title)
    return next as unknown as Title
  }

  async setTags(pageId: string, tags: string[]): Promise<Title> {
    if (this.failing) throw new GrimError('grim timed out')
    const t = this.titles.get(pageId)
    if (!t) throw new NotFoundError(pageId)
    this.calls.push({ op: 'setTags', pageId, arg: tags })
    const next = { ...t, tags }
    this.titles.set(pageId, next)
    return next
  }

  async createTitle(input: { name: string; year?: number; type: 'book'; fields: Partial<Record<FieldKey, string>>; tags: string[] }): Promise<Title> {
    if (this.failing) throw new GrimError('grim timed out')
    const pageTitle = input.year ? `${input.name} (${input.year})` : input.name
    if (this.otherType.has(pageTitle)) throw new TitleConflictError(`${pageTitle} is something other than a book`, 'other-type')
    const existing = [...this.titles.values()].find((t) => t.pageTitle === pageTitle)
    if (existing) return existing
    const t = title({ pageId: `page-${this.nextId++}`, pageTitle, tags: input.tags })
    this.titles.set(t.pageId, t)
    this.calls.push({ op: 'createTitle', pageId: t.pageId, arg: input })
    return this.setFields(t.pageId, input.fields)
  }
}
