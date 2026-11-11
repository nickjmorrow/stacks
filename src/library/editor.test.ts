import { NotFoundError } from '../grimoire/grimoire.ts'
import { Store } from '../store/store.ts'
import { bookRow } from '../store/testRows.ts'
import { BookEditor } from './editor.ts'
import { FakeGrimoire, title } from './fakeGrimoire.ts'

let store: Store
let g: FakeGrimoire
let editor: BookEditor
beforeEach(() => {
  store = new Store(':memory:')
  store.insertBook(bookRow())
  g = new FakeGrimoire([title({ pageId: 'p1', pageTitle: 'Dune' })])
  editor = new BookEditor({ grimoire: g, store, now: () => 5 })
})
afterEach(() => store.close())

test('the editor writes through when grim works', async () => {
  expect(await editor.setFields('b1', { status: 'doing' })).toEqual({ pending: false })
  expect(g.titles.get('p1')?.status).toBe('doing')
  expect(store.pendingGrimoire()).toEqual([])
})

test('when grim fails the edit is queued and answers pending', async () => {
  g.failing = true
  expect(await editor.setTags('b1', ['Gothic'])).toEqual({ pending: true })
  expect(store.pendingGrimoire()).toHaveLength(1)
})

test('retryOutbox writes a queued edit once and clears it', async () => {
  g.failing = true
  await editor.setFields('b1', { status: 'done' })
  g.failing = false
  expect(await editor.retryOutbox()).toBe(1)
  expect(await editor.retryOutbox()).toBe(0)
  expect(g.titles.get('p1')?.status).toBe('done')
  expect(g.calls.filter((c) => c.op === 'setFields')).toHaveLength(1)
})

test('a second edit while one is queued is queued behind it', async () => {
  g.failing = true
  await editor.setFields('b1', { status: 'doing' })
  g.failing = false
  expect(await editor.setFields('b1', { status: 'done' })).toEqual({ pending: true })
  await editor.retryOutbox()
  expect(g.calls.map((c) => (c.arg as { status: string }).status)).toEqual(['doing', 'done'])
  expect(g.titles.get('p1')?.status).toBe('done')
})

test('a failed retry stays queued and counts the attempt', async () => {
  g.failing = true
  await editor.setFields('b1', { status: 'done' })
  expect(await editor.retryOutbox()).toBe(0)
  expect(store.pendingGrimoire()[0]?.attempts).toBe(1)
})

test('an unknown book throws NotFoundError', async () => {
  await expect(editor.setFields('nope', { status: 'done' })).rejects.toBeInstanceOf(NotFoundError)
})

test('an edit made while an earlier one for the same book is still in flight waits behind it', async () => {
  g.delays = [30] // edit A is slow, and grim goes down while it runs
  const a = editor.setFields('b1', { rating: '3' })
  const b = editor.setFields('b1', { rating: '4' })
  setTimeout(() => { g.failing = true }, 10)
  await Promise.all([a, b])
  g.failing = false
  await editor.retryOutbox()
  expect(g.titles.get('p1')?.rating).toBe(4)
})
