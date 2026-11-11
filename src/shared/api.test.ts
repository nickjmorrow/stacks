import { COLORS, type SyncRequest } from './api.ts'

test('COLORS lists the five highlight colors in order', () => {
  expect(COLORS).toEqual(['yellow', 'blue', 'green', 'pink', 'purple'])
})

test('a SyncRequest with one of each record type type-checks', () => {
  const req = {
    device: 'iphone',
    since: 0,
    positions: [{ bookId: 'b1', device: 'iphone', locator: { href: 'ch1.xhtml' }, progression: 0.1, updatedAt: 1 }],
    sessions: [{
      sessionId: 's1', bookId: 'b1', device: 'iphone', startedAt: 1, endedAt: 2,
      activeSeconds: 60, startProgression: 0, endProgression: 0.1, pagesTurned: 4,
    }],
    annotations: [{
      annotationId: 'a1', bookId: 'b1', kind: 'highlight', color: 'yellow', locator: {}, text: 'hi', note: null,
      createdAt: 1, updatedAt: 1, deletedAt: null, device: 'iphone', source: 'stacks',
    }],
  } satisfies SyncRequest
  expect(req.positions).toHaveLength(1)
})
