import type { FieldKey } from '../../src/shared/title.ts'

/** A book page to create (or fill in, when a page with its name already exists). */
export interface PlannedBook {
  /** "Title (Year)" or "Title" */
  pageTitle: string
  fields: Partial<Record<FieldKey, string>>
  tags: string[]
  notes: string[]
  /** Where it came from, for the dry-run report. */
  sources: string[]
}
