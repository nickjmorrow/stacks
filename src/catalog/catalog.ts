// The catalog: each book's status, rating, tags, who recommended it and looked-up details, kept in Stacks'
// own database. It answers the same calls the Grimoire adapter did (GrimoirePort), so the editor, library,
// lookups and file adds are unchanged. Grimoire is only read, once, by `pnpm import-catalog`.

import { randomUUID } from 'node:crypto'
import { NotFoundError, type TagInfo, type TitleDetail } from '../grimoire/grimoire.ts'
import type { GrimoirePort } from '../library/editor.ts'
import type { FieldKey, Status, Title } from '../shared/title.ts'
import type { Store } from '../store/store.ts'

export class Catalog implements GrimoirePort {
  private readonly store: Store
  private readonly now: () => number

  constructor(deps: { store: Store; now?: () => number }) {
    this.store = deps.store
    this.now = deps.now ?? Date.now
  }

  async listTitles(): Promise<Title[]> {
    return this.store.catalogTitles()
  }

  async getTitle(pageId: string): Promise<TitleDetail | null> {
    const t = this.store.catalogTitle(pageId)
    return t ? { ...t, propBlockId: '', notes: [] } : null
  }

  async listTags(): Promise<TagInfo[]> {
    return this.store.catalogTags()
  }

  async pageKind(name: string): Promise<'none' | 'book' | 'other'> {
    const lower = name.toLowerCase()
    return this.store.catalogTitles().some((t) => t.pageTitle.toLowerCase() === lower) ? 'book' : 'none'
  }

  async setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>, opts: { onlyIfStatus?: Status[] } = {}): Promise<Title> {
    const t = this.store.catalogTitle(pageId)
    if (!t) throw new NotFoundError(pageId)
    if (opts.onlyIfStatus && !opts.onlyIfStatus.includes(t.status)) return t
    const next: Record<string, unknown> = { ...t }
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'type') continue
      const key = k === 'apple-books' ? 'appleBooks' : k
      if (v === null || v === undefined || v.trim() === '') delete next[key]
      else next[key] = key === 'rating' || key === 'year' ? Number(v) : key === 'genre' ? v.split(', ') : v
    }
    next.updatedAt = this.now()
    const out = next as unknown as Title
    this.store.catalogPut(out)
    return out
  }

  async setTags(pageId: string, tags: string[]): Promise<Title> {
    const t = this.store.catalogTitle(pageId)
    if (!t) throw new NotFoundError(pageId)
    const next = { ...t, tags: [...new Set(tags)], updatedAt: this.now() }
    this.store.catalogPut(next)
    return next
  }

  /** A book with this page title already in the catalog is returned unchanged. */
  async createTitle(input: { name: string; year?: number; type: 'book'; fields: Partial<Record<FieldKey, string>>; tags: string[] }): Promise<Title> {
    const name = input.name.trim()
    if (!name) throw new Error('a title needs a name')
    const pageTitle = input.year ? `${name} (${input.year})` : name
    const lower = pageTitle.toLowerCase()
    const existing = this.store.catalogTitles().find((t) => t.pageTitle.toLowerCase() === lower)
    if (existing) return existing
    const now = this.now()
    const base: Title = { pageId: `stk-${randomUUID()}`, pageTitle, name, type: 'book', status: 'want', tags: [...new Set(input.tags)], notesText: '', createdAt: now, updatedAt: now }
    if (input.year) base.year = input.year
    this.store.catalogPut(base)
    return this.setFields(base.pageId, input.fields)
  }

  async setTagGroup(tag: string, group: string | null): Promise<void> {
    this.store.catalogSetTagGroup(tag, group)
  }
}
