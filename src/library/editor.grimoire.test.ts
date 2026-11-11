// One real round trip through grim on a temporary graph.

import { grim } from '../grimoire/grim.ts'
import { Grimoire } from '../grimoire/grimoire.ts'
import { makeTestGraph } from '../grimoire/testGraph.ts'
import { Store } from '../store/store.ts'
import { bookRow } from '../store/testRows.ts'
import { BookEditor } from './editor.ts'

let cleanup: () => void
beforeAll(async () => { ({ cleanup } = await makeTestGraph()) })
afterAll(() => cleanup())

test('setFields status done and finished reach the page as author me', async () => {
  const grimoire = new Grimoire({ author: 'me' })
  const abbey = (await grimoire.listTitles()).find((t) => t.pageTitle === 'Northanger Abbey (2021)')!
  const store = new Store(':memory:')
  store.insertBook(bookRow({ pageId: abbey.pageId }))
  const editor = new BookEditor({ grimoire, store, now: () => 5 })
  expect(await editor.setFields('b1', { status: 'done', finished: '2026-10-20' })).toEqual({ pending: false })
  const after = await grimoire.getTitle(abbey.pageId)
  expect(after).toMatchObject({ status: 'done', finished: '2026-10-20' })
  const changes = (await grim(['changes', '--since', '1h'], { author: 'me' })) as unknown[]
  expect(changes.length).toBeGreaterThan(0)
  store.close()
})
