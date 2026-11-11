import { Store } from '../store/store.ts'
import { bookRow } from '../store/testRows.ts'
import { BookEditor } from './editor.ts'
import { FakeGrimoire, title } from './fakeGrimoire.ts'
import { listLibrary } from './library.ts'

let store: Store
beforeEach(() => { store = new Store(':memory:') })
afterEach(() => store.close())

test('listLibrary lists only books that have a store row and a book page', async () => {
  const g = new FakeGrimoire([
    title({ pageId: 'p1', pageTitle: 'Dune (1965)', author: 'Frank Herbert', year: 1965 }),
    title({ pageId: 'p2', pageTitle: 'A Book Store Purchase' }),
  ])
  store.insertBook(bookRow())
  const lib = await listLibrary(g, store)
  expect(lib.books).toHaveLength(1)
  expect(lib.books[0]).toMatchObject({
    bookId: 'b1', pageId: 'p1', pageTitle: 'Dune (1965)', author: 'Frank Herbert', year: 1965, format: 'epub',
    fileSize: 1234, fileSha256: 'sha1', coverUrl: '/api/books/b1/cover', isbn: '9780441013593', lookupState: 'pending',
    lastReadAt: null, pendingEdit: false, appleBooksId: 'AB1',
  })
  expect(lib.cursor).toBe(store.currentCursor())
})

test('a book whose page is no longer a book page is left out', async () => {
  store.insertBook(bookRow())
  expect((await listLibrary(new FakeGrimoire([]), store)).books).toEqual([])
})

test('coverUrl is null for generated covers', async () => {
  store.insertBook(bookRow({ cover: 'generated' }))
  const lib = await listLibrary(new FakeGrimoire([title({ pageId: 'p1', pageTitle: 'Dune' })]), store)
  expect(lib.books[0]?.coverUrl).toBeNull()
})

test('a queued status edit shows in the library with pendingEdit', async () => {
  const g = new FakeGrimoire([title({ pageId: 'p1', pageTitle: 'Dune' })])
  store.insertBook(bookRow())
  const editor = new BookEditor({ grimoire: g, store, now: () => 5 })
  g.failing = true
  expect(await editor.setFields('b1', { status: 'done', rating: '5' })).toEqual({ pending: true })
  const book = (await listLibrary(g, store)).books[0]
  expect(book).toMatchObject({ status: 'done', rating: 5, pendingEdit: true })
})
