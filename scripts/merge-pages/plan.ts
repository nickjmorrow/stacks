// Apple Books items whose names match one of the owner's own (untyped) pages. Pages listed in
// `merges` are notes on the book and become the book's page; pages in `separate` are about the idea,
// so the book gets its own page. The lists come from a local JSON file (see cli.ts).

import type { FieldKey } from '../../src/shared/title.ts'
import { cleanTitle, statusOf } from '../import-apple-books/plan.ts'
import type { AppleBook } from '../import-apple-books/appleBooks.ts'
import type { ExistingPage } from '../lib/live.ts'

export interface MergeLists {
  /** Existing page names that become the book's page. */
  merges: string[]
  /** Books that get a new page `page`, found by `match`, because the same-name page is about something else. */
  separate: { page: string; match: string; year: number }[]
}

export interface MergePlan {
  action: 'merge' | 'separate'
  /** merge: the existing page's name as spelled; separate: the new page's name */
  page: string
  assetId: string
  fields: Partial<Record<FieldKey, string>>
}

function sameName(appleTitle: string, name: string): boolean {
  const t = cleanTitle(appleTitle).toLowerCase()
  const n = name.toLowerCase()
  return t === n || t.split(':')[0]!.trim() === n
}

export function planMerges(
  books: AppleBook[],
  existing: Map<string, ExistingPage>,
  lists: MergeLists,
): { plans: MergePlan[]; missing: string[]; skipped: string[] } {
  const plans: MergePlan[] = []
  const missing: string[] = []
  const skipped: string[] = []
  const fieldsFor = (b: AppleBook): Partial<Record<FieldKey, string>> => {
    const f: Partial<Record<FieldKey, string>> = {}
    if (b.author) f.author = b.author
    f['apple-books'] = b.assetId
    f.status = statusOf(b)
    return f
  }
  const find = (name: string) => {
    // The owner's own file first: its Apple Books ID is what links the page to the file in Stacks.
    const matches = books.filter((x) => sameName(x.title, name))
    const b = matches.find((x) => x.path) ?? matches[0]
    const p = existing.get(name.toLowerCase())
    if (!b) missing.push(`${name}: no Apple Books item`)
    else if (!p) missing.push(`${name}: no page named ${name}`)
    else if (p.isTitle) {
      skipped.push(`${p.title}: already a book page`)
      return null
    }
    return b && p ? { b, p } : null
  }
  for (const name of lists.merges) {
    const hit = find(name)
    if (hit) plans.push({ action: 'merge', page: hit.p.title, assetId: hit.b.assetId, fields: fieldsFor(hit.b) })
  }
  for (const s of lists.separate) {
    const hit = find(s.match)
    if (hit) plans.push({ action: 'separate', page: s.page, assetId: hit.b.assetId, fields: { ...fieldsFor(hit.b), year: String(s.year) } })
  }
  return { plans, missing, skipped }
}
