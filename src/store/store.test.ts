import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './store.ts'
import { bookRow } from './testRows.ts'

let store: Store
beforeEach(() => { store = new Store(':memory:') })
afterEach(() => store.close())

test('insert then getBook round-trips every field', () => {
  store.insertBook(bookRow())
  expect(store.getBook('b1')).toEqual(bookRow())
})

test('a book with nulls round-trips', () => {
  const row = bookRow({ isbn: null, publisher: null, language: null, pageCount: null, olWork: null, olEdition: null, appleBooksId: null, cover: 'generated' })
  store.insertBook(row)
  expect(store.getBook('b1')).toEqual(row)
})

test('bookBySha, bookByPage and bookByAppleBooksId find the row', () => {
  store.insertBook(bookRow())
  expect(store.bookBySha('sha1')?.bookId).toBe('b1')
  expect(store.bookByPage('p1')?.bookId).toBe('b1')
  expect(store.bookByAppleBooksId('AB1')?.bookId).toBe('b1')
  expect(store.getBook('nope')).toBeNull()
})

test('inserting a second book with the same sha throws', () => {
  store.insertBook(bookRow())
  expect(() => store.insertBook(bookRow({ bookId: 'b2', pageId: 'p2' }))).toThrow()
})

test('updateBook changes only the given fields and raises the cursor', () => {
  store.insertBook(bookRow())
  const before = store.currentCursor()
  store.updateBook('b1', { lookupState: 'done', olWork: 'OL9W' })
  expect(store.getBook('b1')).toEqual(bookRow({ lookupState: 'done', olWork: 'OL9W' }))
  expect(store.currentCursor()).toBeGreaterThan(before)
})

test('listBooks lists every book', () => {
  store.insertBook(bookRow())
  store.insertBook(bookRow({ bookId: 'b2', pageId: 'p2', fileSha256: 'sha2' }))
  expect(store.listBooks().map((b) => b.bookId).sort()).toEqual(['b1', 'b2'])
})

test('a file-backed store survives close and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stacks-store-'))
  try {
    const path = join(dir, 'nested', 'stacks.db')
    const s1 = new Store(path)
    s1.insertBook(bookRow())
    s1.close()
    const s2 = new Store(path)
    expect(s2.getBook('b1')).toEqual(bookRow())
    s2.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
