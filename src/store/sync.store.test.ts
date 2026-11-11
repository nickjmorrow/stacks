import type { Annotation, Position, Session } from '../shared/api.ts'
import { Store } from './store.ts'

const pos = (over: Partial<Position> = {}): Position =>
  ({ bookId: 'b1', device: 'iphone', locator: { href: 'c1.xhtml', locations: { progression: 0.5 } }, progression: 0.2, updatedAt: 100, ...over })
const ses = (over: Partial<Session> = {}): Session => ({
  sessionId: 's1', bookId: 'b1', device: 'iphone', startedAt: 100, endedAt: 200,
  activeSeconds: 90, startProgression: 0.1, endProgression: 0.2, pagesTurned: 5, ...over,
})
const ann = (over: Partial<Annotation> = {}): Annotation => ({
  annotationId: 'a1', bookId: 'b1', kind: 'highlight', color: 'yellow', locator: { href: 'c1.xhtml', text: { highlight: 'x' } },
  text: 'x', note: null, createdAt: 100, updatedAt: 100, deletedAt: null, device: 'iphone', source: 'stacks', ...over,
})

let store: Store
beforeEach(() => { store = new Store(':memory:') })
afterEach(() => store.close())

test('an older position for the same device is ignored, a newer one applied', () => {
  expect(store.putPosition(pos())).toBe(true)
  expect(store.putPosition(pos({ progression: 0.1, updatedAt: 50 }))).toBe(false)
  expect(store.positionsFor('b1')).toEqual([pos()])
  expect(store.putPosition(pos({ progression: 0.3, updatedAt: 150 }))).toBe(true)
  expect(store.positionsFor('b1')[0]?.progression).toBe(0.3)
})

test('positions from two devices for one book are kept separately', () => {
  store.putPosition(pos())
  store.putPosition(pos({ device: 'ipad', progression: 0.6 }))
  expect(store.positionsFor('b1').map((p) => p.device).sort()).toEqual(['ipad', 'iphone'])
})

test('an annotation with an equal updatedAt is ignored', () => {
  store.putAnnotation(ann())
  expect(store.putAnnotation(ann({ note: 'later?', updatedAt: 100 }))).toBe(false)
  expect(store.annotationsFor('b1')[0]?.note).toBeNull()
})

test('a strictly newer annotation is applied', () => {
  store.putAnnotation(ann())
  expect(store.putAnnotation(ann({ note: 'yes', updatedAt: 101 }))).toBe(true)
  expect(store.annotationsFor('b1')[0]?.note).toBe('yes')
})

test('a delete is applied and still returned by changesSince', () => {
  store.putAnnotation(ann())
  const cursor = store.currentCursor()
  store.putAnnotation(ann({ deletedAt: 300, updatedAt: 300 }))
  const changes = store.changesSince(cursor)
  expect(changes.annotations).toEqual([ann({ deletedAt: 300, updatedAt: 300 })])
})

test('putSession twice with the same session is stored once', () => {
  expect(store.putSession(ses())).toBe(true)
  expect(store.putSession(ses())).toBe(false)
  expect(store.sessionsBetween(0, 1000)).toEqual([ses()])
})

test('a session with a later endedAt replaces it', () => {
  store.putSession(ses())
  expect(store.putSession(ses({ endedAt: 400, activeSeconds: 250 }))).toBe(true)
  expect(store.sessionsBetween(0, 1000)).toEqual([ses({ endedAt: 400, activeSeconds: 250 })])
})

test('sessionsBetween filters by startedAt', () => {
  store.putSession(ses())
  store.putSession(ses({ sessionId: 's2', startedAt: 5000, endedAt: 6000 }))
  expect(store.sessionsBetween(1000, 10000).map((s) => s.sessionId)).toEqual(['s2'])
})

test('changesSince returns only rows written after the cursor, and the new cursor', () => {
  store.putPosition(pos())
  const cursor = store.currentCursor()
  store.putSession(ses())
  const changes = store.changesSince(cursor)
  expect(changes.positions).toEqual([])
  expect(changes.sessions).toEqual([ses()])
  expect(changes.cursor).toBe(store.currentCursor())
})

test('with nothing new, changesSince returns the same cursor and empty lists', () => {
  store.putPosition(pos())
  const cursor = store.currentCursor()
  expect(store.changesSince(cursor)).toEqual({ cursor, positions: [], sessions: [], annotations: [] })
})

test('lastReadAt is the newest position time for the book', () => {
  expect(store.lastReadAt('b1')).toBeNull()
  store.putPosition(pos())
  store.putPosition(pos({ device: 'ipad', updatedAt: 900 }))
  expect(store.lastReadAt('b1')).toBe(900)
})

test('outbox items come back in order; finish removes, fail counts attempts', () => {
  store.enqueueGrimoire('b1', 'setFields', { status: 'done' }, 1)
  store.enqueueGrimoire('b1', 'setTags', ['Gothic'], 2)
  expect(store.hasPendingGrimoire('b1')).toBe(true)
  const [first, second] = store.pendingGrimoire()
  expect(first).toMatchObject({ bookId: 'b1', op: 'setFields', payload: { status: 'done' }, attempts: 0 })
  expect(second?.op).toBe('setTags')
  store.failGrimoire(first!.id, 'grim timed out')
  expect(store.pendingGrimoire()[0]?.attempts).toBe(1)
  store.finishGrimoire(first!.id)
  store.finishGrimoire(second!.id)
  expect(store.hasPendingGrimoire('b1')).toBe(false)
})

test('progress writes are remembered per book', () => {
  expect(store.progressWrite('b1')).toBeNull()
  store.setProgressWrite('b1', '2026-10-20', 43)
  expect(store.progressWrite('b1')).toEqual({ day: '2026-10-20', percent: 43 })
})

test('a device whose cursor is ahead of the store (after a restore) gets everything, and the real cursor', () => {
  store.putPosition(pos())
  store.putSession(ses())
  const changes = store.changesSince(9_999)
  expect(changes.positions).toHaveLength(1)
  expect(changes.sessions).toHaveLength(1)
  expect(changes.cursor).toBe(store.currentCursor())
})
