// Plans the Apple Books import: which book title pages to create and which existing ones to update.

import type { FieldKey, Status, Title } from '../../src/shared/title.ts'
import type { PlannedBook as PlannedTitle } from '../lib/planned.ts'
import type { AppleBook } from './appleBooks.ts'
import { cleanTitle, lc, sameWork } from '../../src/shared/sameWork.ts'

export { cleanTitle }

export type { AppleBook }

export interface ImportPlan {
  create: PlannedTitle[]
  update: { pageId: string; fields: Partial<Record<FieldKey, string>> }[]
  skipped: { assetId: string; title: string; reason: string }[]
}

const RANK: Record<Status, number> = { want: 0, doing: 1, done: 2, dropped: -1 }

/** finished → done, any progress → doing, else want. */
export function statusOf(b: AppleBook): Status {
  return b.finished ? 'done' : b.progress > 0 ? 'doing' : 'want'
}

function pageTitleOf(b: AppleBook): string {
  const t = cleanTitle(b.title)
  return b.year ? `${t} (${b.year})` : t
}

export function planImport(books: AppleBook[], existing: Title[]): ImportPlan {
  const plan: ImportPlan = { create: [], update: [], skipped: [] }
  const existingBooks = existing.filter((t) => t.type === 'book')
  const claimed = new Set<string>() // existing pageIds already matched by a book
  const createdByTitle = new Map<string, number>() // lowercased new page title -> index in plan.create

  // The owner's own files first (their IDs are what link a page to its file in Stacks), then best first,
  // so duplicates in the library resolve to the furthest-along asset.
  const ordered = books
    .map((b, i) => ({ b, i }))
    .sort((x, y) => Number(!!y.b.path) - Number(!!x.b.path) || RANK[statusOf(y.b)] - RANK[statusOf(x.b)] || y.b.progress - x.b.progress || x.i - y.i)
    .map((x) => x.b)

  // Exact apple-books matches claim their pages first.
  const byAsset = new Map<string, Title>()
  for (const t of existingBooks) if (t.appleBooks) byAsset.set(t.appleBooks, t)
  const matchOf = new Map<string, Title>()
  for (const b of ordered) {
    const t = byAsset.get(b.assetId)
    if (t) {
      matchOf.set(b.assetId, t)
      claimed.add(t.pageId)
    }
  }

  function findMatch(b: AppleBook): Title | undefined {
    const exact = matchOf.get(b.assetId)
    if (exact) return exact
    const pt = lc(pageTitleOf(b))
    const byPage = existingBooks.find((t) => lc(t.pageTitle) === pt)
    if (byPage) return byPage
    const byName = existingBooks.filter((t) => lc(t.name) === lc(cleanTitle(b.title)))
    if (byName.length === 1) return byName[0]
    const byWork = existingBooks.filter((t) => sameWork(t.name, t.author, b.title, b.author))
    if (byWork.length === 1) return byWork[0]
    return undefined
  }

  /** A skipped duplicate that is further along moves the page's planned status forward. */
  function raiseStatus(fields: Partial<Record<FieldKey, string>>, current: Status, b: AppleBook): void {
    const target = statusOf(b)
    const planned = (fields.status as Status | undefined) ?? current
    if (current !== 'dropped' && RANK[target] > RANK[planned]) fields.status = target
  }
  const updates = new Map<string, Partial<Record<FieldKey, string>>>()

  for (const b of ordered) {
    const skip = (reason: string) => plan.skipped.push({ assetId: b.assetId, title: b.title, reason })
    const match = findMatch(b)
    if (match) {
      // Another asset (a library duplicate, or another edition) already owns this page.
      if (claimed.has(match.pageId) && matchOf.get(b.assetId) !== match) {
        skip(lc(cleanTitle(b.title)) === lc(match.name) ? 'duplicate in Apple Books' : `same book as "${match.pageTitle}"`)
        const fields = updates.get(match.pageId) ?? {}
        raiseStatus(fields, match.status, b)
        if (Object.keys(fields).length > 0 && !updates.has(match.pageId)) {
          updates.set(match.pageId, fields)
          plan.update.push({ pageId: match.pageId, fields })
        }
        continue
      }
      claimed.add(match.pageId)
      const fields: Partial<Record<FieldKey, string>> = {}
      if (!match.appleBooks) fields['apple-books'] = b.assetId
      if (!match.author && b.author) fields.author = b.author
      if (match.year === undefined && b.year) fields.year = String(b.year)
      const target = statusOf(b)
      if (match.status !== 'dropped' && RANK[target] > RANK[match.status]) fields.status = target
      if (Object.keys(fields).length > 0) {
        updates.set(match.pageId, fields)
        plan.update.push({ pageId: match.pageId, fields })
      }
      continue
    }

    const pageTitle = pageTitleOf(b)
    const key = lc(pageTitle)
    if (createdByTitle.has(key)) {
      skip('duplicate in Apple Books')
      continue
    }
    const edition = plan.create.find((c) => sameWork(c.pageTitle, c.fields.author, b.title, b.author))
    if (edition) {
      skip(`same book as "${edition.pageTitle}"`)
      raiseStatus(edition.fields, 'want', b)
      continue
    }
    const fields: Partial<Record<FieldKey, string>> = { status: statusOf(b) }
    if (b.author) fields.author = b.author
    if (b.year) fields.year = String(b.year)
    fields['apple-books'] = b.assetId
    createdByTitle.set(key, plan.create.length)
    plan.create.push({ pageTitle, fields, tags: [], notes: [], sources: ['Apple Books'] })
  }

  return plan
}
