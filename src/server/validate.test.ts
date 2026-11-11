import { BadRequest, parseBookPatch, parseSyncRequest } from './validate.ts'

const position = { bookId: 'b1', device: 'iphone', locator: { href: 'c1.xhtml' }, progression: 0.5, updatedAt: 10 }
const session = { sessionId: 's1', bookId: 'b1', device: 'iphone', startedAt: 1, endedAt: 2, activeSeconds: 1, startProgression: 0, endProgression: 0.1, pagesTurned: 1 }
const annotation = {
  annotationId: 'a1', bookId: 'b1', kind: 'note', color: 'blue', locator: { href: 'c1.xhtml' }, text: 'x', note: 'mine',
  createdAt: 1, updatedAt: 1, deletedAt: null, device: 'iphone', source: 'stacks',
}
const sync = { device: 'iphone', since: 0, positions: [position], sessions: [session], annotations: [annotation] }

describe('parseSyncRequest', () => {
  test('accepts a full valid request', () => expect(parseSyncRequest(sync)).toEqual(sync))
  test('rejects a list over 5,000', () =>
    expect(() => parseSyncRequest({ ...sync, positions: Array(5001).fill(position) })).toThrow(BadRequest))
  test('rejects a progression above 1', () =>
    expect(() => parseSyncRequest({ ...sync, positions: [{ ...position, progression: 1.5 }] })).toThrow(/progression/))
  test('rejects an unknown color', () =>
    expect(() => parseSyncRequest({ ...sync, annotations: [{ ...annotation, color: 'red' }] })).toThrow(/color/))
  test('rejects a locator over 16 KB', () =>
    expect(() => parseSyncRequest({ ...sync, positions: [{ ...position, locator: { x: 'a'.repeat(17_000) } }] })).toThrow(/locator/))
  test('rejects a note over 20,000 characters', () =>
    expect(() => parseSyncRequest({ ...sync, annotations: [{ ...annotation, note: 'a'.repeat(20_001) }] })).toThrow(/note/))
  test('rejects a missing device', () => expect(() => parseSyncRequest({ ...sync, device: '' })).toThrow(/device/))
})

describe('parseBookPatch', () => {
  test('accepts status, rating, rec, finished and tags', () =>
    expect(parseBookPatch({ status: 'done', rating: 5, rec: 'Alice', finished: '2026-10-20', tags: ['Gothic'] })).toEqual({
      fields: { status: 'done', rating: '5', rec: 'Alice', finished: '2026-10-20' }, tags: ['Gothic'],
    }))
  test('null clears a field', () => expect(parseBookPatch({ rating: null })).toEqual({ fields: { rating: null } }))
  test('rejects a rating of 6', () => expect(() => parseBookPatch({ rating: 6 })).toThrow(BadRequest))
  test('rejects an unknown status', () => expect(() => parseBookPatch({ status: 'paused' })).toThrow(/status/))
  test('rejects a date that does not exist', () => expect(() => parseBookPatch({ finished: '2026-02-30' })).toThrow(/finished/))
  test('rejects media as a tag', () => expect(() => parseBookPatch({ tags: ['media'] })).toThrow(/media/))
  test('rejects an unknown key', () => expect(() => parseBookPatch({ summary: 'x' })).toThrow(/summary/))
})

test('closing is an optional book id', () => {
  expect(parseSyncRequest({ ...sync, closing: 'b1' }).closing).toBe('b1')
  expect(parseSyncRequest(sync).closing).toBeUndefined()
  expect(() => parseSyncRequest({ ...sync, closing: true })).toThrow(/closing/)
})
