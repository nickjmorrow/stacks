// Writing an Apple Books import plan to Grimoire. The writer must be built with author `claude`.

import type { FieldKey, MediaType, Title } from '../../src/shared/title.ts'
import { splitPageTitle } from '../../src/shared/titleFormat.ts'
import { TitleConflictError } from '../../src/grimoire/grimoire.ts'
import type { ImportPlan } from './plan.ts'

export interface ImportWriter {
  createTitle(input: { name: string; year?: number; type: MediaType; fields: Partial<Record<FieldKey, string>>; tags: string[] }): Promise<Title>
  setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>): Promise<Title>
}

export interface ImportCounts { created: number; updated: number; failed: { name: string; error: string }[] }

/** Creates and updates book pages; one book's failure is recorded and the rest continue. */
export async function applyImport(plan: ImportPlan, writer: ImportWriter): Promise<ImportCounts> {
  const counts: ImportCounts = { created: 0, updated: 0, failed: [] }
  for (const t of plan.create) {
    const { name, year } = splitPageTitle(t.pageTitle)
    const create = (n: string) => writer.createTitle({ name: n, ...(year !== undefined ? { year } : {}), type: 'book', fields: t.fields, tags: t.tags })
    try {
      // A page with this name may already be one of Hoard's titles (a movie of the same name): use "Name (book)".
      await create(name).catch((e: unknown) => {
        if (e instanceof TitleConflictError && e.reason === 'other-type' && year === undefined) return create(`${name} (book)`)
        throw e
      })
      counts.created++
    } catch (e) {
      counts.failed.push({ name: t.pageTitle, error: e instanceof Error ? e.message : String(e) })
    }
  }
  for (const u of plan.update) {
    try {
      await writer.setFields(u.pageId, u.fields)
      counts.updated++
    } catch (e) {
      counts.failed.push({ name: u.pageId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return counts
}
