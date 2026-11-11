// Copies each book's Grimoire page data (status, rating, tags, recommended by, looked-up details) and every
// tag group (shared with Hoard; the filter menus keep the groups they had) into the Stacks database. Pure: the CLI reads Grimoire and passes what it found.

import type { TagInfo } from '../../src/grimoire/grimoire.ts'
import type { Title } from '../../src/shared/title.ts'
import type { Store } from '../../src/store/store.ts'

export interface CopyResult { copied: number; missingPage: string[]; groups: number }

/** Only titles that a Stacks book points at are copied. Safe to re-run: a book's row is replaced by Grimoire's copy. */
export function copyCatalog(store: Store, titles: Title[], tags: TagInfo[], opts: { apply: boolean }): CopyResult {
  const byPage = new Map(titles.map((t) => [t.pageId, t]))
  const result: CopyResult = { copied: 0, missingPage: [], groups: 0 }
  for (const book of store.listBooks()) {
    const t = byPage.get(book.pageId)
    if (!t) {
      result.missingPage.push(book.bookId)
      continue
    }
    if (opts.apply) store.catalogPut(t)
    result.copied++
  }
  for (const tag of tags) {
    if (!tag.group) continue
    if (opts.apply) store.catalogSetTagGroup(tag.title, tag.group)
    result.groups++
  }
  return result
}
