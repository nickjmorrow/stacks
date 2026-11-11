import type { Annotation, Position, Session, SyncRequest } from '../shared/api.ts'
import { BookEditor } from '../library/editor.ts'
import { FakeGrimoire, title } from '../library/fakeGrimoire.ts'
import { Store } from '../store/store.ts'
import { bookRow } from '../store/testRows.ts'
import { applySync } from './sync.ts'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 20, 15) // 11:00 in New York

const pos = (over: Partial<Position> = {}): Position =>
  ({ bookId: 'b1', device: 'iphone', locator: { href: 'c1.xhtml' }, progression: 0.43, updatedAt: T0, ...over })
const ses: Session = {
  sessionId: 's1', bookId: 'b1', device: 'iphone', startedAt: T0 - 60_000, endedAt: T0,
  activeSeconds: 60, startProgression: 0.4, endProgression: 0.43, pagesTurned: 3,
}
const ann: Annotation = {
  annotationId: 'a1', bookId: 'b1', kind: 'highlight', color: 'yellow', locator: { href: 'c1.xhtml' }, text: 'x', note: null,
  createdAt: T0, updatedAt: T0, deletedAt: null, device: 'iphone', source: 'stacks',
}
const req = (over: Partial<SyncRequest> = {}): SyncRequest =>
  ({ device: 'iphone', since: 0, positions: [], sessions: [], annotations: [], closing: 'b1', ...over })

let store: Store
let g: FakeGrimoire
let now: number
let deps: Parameters<typeof applySync>[0]
beforeEach(() => {
  store = new Store(':memory:')
  store.insertBook(bookRow())
  g = new FakeGrimoire([title({ pageId: 'p1', pageTitle: 'Dune', status: 'want' })])
  now = T0
  deps = { store, editor: new BookEditor({ grimoire: g, store, now: () => now }), now: () => now, timeZone: 'America/New_York' }
})
afterEach(() => store.close())

const progressWrites = () => g.calls.filter((c) => 'progress' in (c.arg as object)).map((c) => (c.arg as { progress: string }).progress)

test('a position a few percent in on a want book sets it to doing', async () => {
  await applySync(deps, req({ positions: [pos()] }))
  expect(g.titles.get('p1')?.status).toBe('doing')
})

test('just opening a book (under 3%) leaves it as want, and reading further sets it to doing', async () => {
  await applySync(deps, req({ positions: [pos({ progression: 0.01 })] }))
  expect(g.titles.get('p1')?.status).toBe('want')
  now = T0 + 60_000
  await applySync(deps, req({ positions: [pos({ progression: 0.05, updatedAt: now })] }))
  expect(g.titles.get('p1')?.status).toBe('doing')
})

test('a book already being read is not changed back', async () => {
  g.titles.set('p1', title({ pageId: 'p1', pageTitle: 'Dune', status: 'done' }))
  await applySync(deps, req({ positions: [pos()] }))
  expect(g.titles.get('p1')?.status).toBe('done')
})

test('progress is written at most once a day', async () => {
  await applySync(deps, req({ positions: [pos()] }))
  now = T0 + 60_000
  await applySync(deps, req({ positions: [pos({ progression: 0.5, updatedAt: now })] }))
  now = T0 + DAY
  await applySync(deps, req({ positions: [pos({ progression: 0.5, updatedAt: now })] }))
  expect(progressWrites()).toEqual(['43%', '50%'])
})

test('the same percent on a new day writes nothing', async () => {
  await applySync(deps, req({ positions: [pos()] }))
  now = T0 + DAY
  await applySync(deps, req({ positions: [pos({ progression: 0.439, updatedAt: now })] }))
  expect(progressWrites()).toEqual(['43%'])
})

test('the same batch sent twice stores one session and one annotation, and the cursor stays', async () => {
  const batch = req({ positions: [pos()], sessions: [ses], annotations: [ann] })
  const first = await applySync(deps, batch)
  const second = await applySync(deps, batch)
  expect(store.sessionsBetween(0, T0 + DAY)).toHaveLength(1)
  expect(store.annotationsFor('b1')).toHaveLength(1)
  expect(second.cursor).toBe(first.cursor)
})

test('records for an unknown book are skipped', async () => {
  const res = await applySync(deps, req({ positions: [pos({ bookId: 'nope' })], sessions: [{ ...ses, bookId: 'nope' }] }))
  expect(res).toEqual({ cursor: 1, positions: [], sessions: [], annotations: [] })
  expect(g.calls).toEqual([])
})

test('the answer includes changes from other devices since the cursor', async () => {
  const ipad = await applySync(deps, req({ device: 'ipad', positions: [pos({ device: 'ipad', progression: 0.6 })] }))
  const res = await applySync(deps, req({ since: 0, positions: [pos()] }))
  expect(res.positions.map((p) => p.device).sort()).toEqual(['ipad', 'iphone'])
  expect(res.cursor).toBeGreaterThan(ipad.cursor)
})

test('opening a book at the very start writes no progress', async () => {
  await applySync(deps, req({ positions: [pos({ progression: 0.004 })] }))
  expect(progressWrites()).toEqual([])
})

test('positions imported from Apple Books change nothing in Grimoire', async () => {
  await applySync(deps, req({ device: 'apple-books', positions: [pos({ device: 'apple-books', progression: 0.6 })] }))
  expect(g.calls).toEqual([])
  expect(store.positionsFor('b1')).toHaveLength(1)
})

test('syncs while reading write no progress; closing the book writes where this device stopped', async () => {
  await applySync(deps, req({ positions: [pos({ progression: 0.2 })], closing: undefined }))
  now = T0 + 600_000
  await applySync(deps, req({ positions: [pos({ progression: 0.31, updatedAt: now })], closing: undefined }))
  expect(progressWrites()).toEqual([])
  await applySync(deps, req({ positions: [], closing: 'b1' })) // the last position was already sent
  expect(progressWrites()).toEqual(['31%'])
})
