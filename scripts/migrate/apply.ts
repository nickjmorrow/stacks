// Writes planned books from the old `books` page as book title pages (author `claude`, so undoable).

import type { FieldKey, MediaType, Title } from '../../src/shared/title.ts'
import { splitPageTitle } from '../../src/shared/titleFormat.ts'
import { TitleConflictError, type TitleDetail } from '../../src/grimoire/grimoire.ts'
import type { PlannedBook } from '../lib/planned.ts'

export interface MigrationWriter {
  createTitle(input: { name: string; year?: number; type: MediaType; fields: Partial<Record<FieldKey, string>>; tags: string[] }): Promise<Title>
  getTitle(pageId: string): Promise<TitleDetail | null>
  addNote(pageId: string, text: string): Promise<{ id: string }>
}

export interface MigrationCounts { written: number; notes: number; failed: { name: string; error: string }[] }

export async function applyBooks(books: PlannedBook[], writer: MigrationWriter): Promise<MigrationCounts> {
  const counts: MigrationCounts = { written: 0, notes: 0, failed: [] }
  for (const b of books) {
    const { name, year } = splitPageTitle(b.pageTitle)
    const create = (n: string) => writer.createTitle({ name: n, ...(year !== undefined ? { year } : {}), type: 'book', fields: b.fields, tags: b.tags })
    try {
      const t = await create(name).catch((e: unknown) => {
        if (e instanceof TitleConflictError && e.reason === 'other-type' && year === undefined) return create(`${name} (book)`)
        throw e
      })
      counts.written++
      const have = new Set(((await writer.getTitle(t.pageId))?.notes ?? []).map((n) => n.text.trim()))
      for (const note of b.notes) {
        if (have.has(note.trim())) continue
        have.add(note.trim())
        await writer.addNote(t.pageId, note)
        counts.notes++
      }
    } catch (e) {
      counts.failed.push({ name: b.pageTitle, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return counts
}
