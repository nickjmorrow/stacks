import { expect, test } from 'vitest'
import { Catalog } from '../../src/catalog/catalog.ts'
import { title } from '../../src/library/fakeGrimoire.ts'
import { Store } from '../../src/store/store.ts'
import { copyCatalog } from './copy.ts'

function bookRow(bookId: string, pageId: string, sha: string) {
  return {
    bookId, pageId, format: 'epub' as const, fileSha256: sha, fileSize: 1, originalName: 'x.epub', isbn: null, publisher: null,
    language: null, pageCount: null, olWork: null, olEdition: null, cover: 'generated' as const, appleBooksId: null,
    addedAt: 1, lookupState: 'done' as const, lookupTriedAt: null,
  }
}

test('copies a linked book\'s page data and every tag group, and only a dry run reports without writing', async () => {
  const store = new Store(':memory:')
  store.insertBook(bookRow('b1', 'p1', 's1'))
  store.insertBook(bookRow('b2', 'gone', 's2'))
  const titles = [title({ pageId: 'p1', pageTitle: 'Dune', status: 'doing', rating: 5, tags: ['scifi'] }), title({ pageId: 'p9', pageTitle: 'Other', tags: ['x'] })]
  const tags = [{ title: 'scifi', group: 'Style', count: 1 }, { title: 'x', group: 'Vibe', count: 1 }]

  const dry = copyCatalog(store, titles, tags, { apply: false })
  expect(dry).toEqual({ copied: 1, missingPage: ['b2'], groups: 2 })
  expect(await new Catalog({ store }).listTitles()).toEqual([])

  copyCatalog(store, titles, tags, { apply: true })
  const catalog = new Catalog({ store })
  expect((await catalog.listTitles()).map((t) => [t.pageId, t.status, t.rating, t.tags])).toEqual([['p1', 'doing', 5, ['scifi']]])
  expect(await catalog.listTags()).toEqual([{ title: 'scifi', group: 'Style', count: 1 }, { title: 'x', group: 'Vibe', count: 0 }])
})
