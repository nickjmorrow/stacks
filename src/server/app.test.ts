import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEpubFolder } from '../../test/fixtures/makeEpub.ts'
import { zipEpubFolder } from '../epub/zip.ts'
import type { EnricherPort } from '../enrich/port.ts'
import type { FilesDeps } from '../files/addFile.ts'
import { BookEditor } from '../library/editor.ts'
import { FakeGrimoire, title } from '../library/fakeGrimoire.ts'
import type { LibraryResponse, SyncRequest, SyncResponse } from '../shared/api.ts'
import { Store } from '../store/store.ts'
import { bookRow } from '../store/testRows.ts'
import { createApp } from './app.ts'

const T0 = Date.UTC(2026, 9, 20, 15)
let home: string
let store: Store
let g: FakeGrimoire
let enrichSoon: string[]
let app: ReturnType<typeof createApp>
const FILE = Buffer.from(Array.from({ length: 100 }, (_, i) => i))

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stacks-app-'))
  store = new Store(':memory:')
  store.insertBook(bookRow({ fileSize: FILE.length, cover: 'embedded' }))
  mkdirSync(join(home, 'files'))
  writeFileSync(join(home, 'files', 'b1.epub'), FILE)
  mkdirSync(join(home, 'covers'))
  writeFileSync(join(home, 'covers', 'b1.jpg'), 'jpeg')
  g = new FakeGrimoire([title({ pageId: 'p1', pageTitle: 'Dune (1965)', author: 'Frank Herbert', year: 1965, summary: 'Spice.' })])
  enrichSoon = []
  const enricher: EnricherPort = {
    needsLook: async () => [{ bookId: 'b1', pageTitle: 'Dune (1965)', candidates: [] }],
    match: async () => {},
    enrichSoon: (id) => { enrichSoon.push(id) },
  }
  const files: FilesDeps = { store, grimoire: g, home, fetch: async () => new Response('', { status: 404 }), now: () => T0 }
  const editor = new BookEditor({ grimoire: g, store, now: () => T0 })
  app = createApp({ grimoire: g, store, editor, files, enricher, now: () => T0, timeZone: 'America/New_York' })
})
afterEach(() => {
  store.close()
  rmSync(home, { recursive: true, force: true })
})

test('GET /api/library answers the books and the cursor', async () => {
  const res = await app.request('/api/library')
  expect(res.status).toBe(200)
  const body = (await res.json()) as LibraryResponse
  expect(body.books.map((b) => b.pageTitle)).toEqual(['Dune (1965)'])
  expect(body.cursor).toBe(store.currentCursor())
  writeFileSync(new URL('../../app-fixtures/library.json', import.meta.url), JSON.stringify(body, null, 2) + '\n')
})

test('GET file answers the whole file with its type and ETag', async () => {
  const res = await app.request('/api/books/b1/file')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/epub+zip')
  expect(res.headers.get('etag')).toBe('"sha1"')
  expect(res.headers.get('accept-ranges')).toBe('bytes')
  expect(Buffer.from(await res.arrayBuffer())).toEqual(FILE)
})

test('GET file with a Range answers 206 with exactly those bytes', async () => {
  const res = await app.request('/api/books/b1/file', { headers: { range: 'bytes=10-19' } })
  expect(res.status).toBe(206)
  expect(res.headers.get('content-range')).toBe('bytes 10-19/100')
  expect(res.headers.get('content-length')).toBe('10')
  expect(Buffer.from(await res.arrayBuffer())).toEqual(FILE.subarray(10, 20))
})

test('an impossible Range answers 416', async () => {
  const res = await app.request('/api/books/b1/file', { headers: { range: 'bytes=500-' } })
  expect(res.status).toBe(416)
  expect(res.headers.get('content-range')).toBe('bytes */100')
})

test('GET cover answers the JPEG', async () => {
  const res = await app.request('/api/books/b1/cover')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('image/jpeg')
})

test('PATCH status done answers the updated book', async () => {
  const res = await app.request('/api/books/b1', { method: 'PATCH', body: JSON.stringify({ status: 'done', finished: '2026-10-20', rating: 5 }) })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { book: { status: string; rating: number }; pending: boolean }
  expect(body).toMatchObject({ pending: false, book: { status: 'done', rating: 5, finished: '2026-10-20' } })
  expect(g.titles.get('p1')?.status).toBe('done')
})

test('PATCH with a bad rating answers 400', async () => {
  const res = await app.request('/api/books/b1', { method: 'PATCH', body: JSON.stringify({ rating: 9 }) })
  expect(res.status).toBe(400)
})

test('POST /api/sync stores records and answers the changes', async () => {
  const req: SyncRequest = {
    device: 'iphone', since: 0,
    positions: [{ bookId: 'b1', device: 'iphone', locator: { href: 'OEBPS/ch1.xhtml', type: 'application/xhtml+xml', locations: { progression: 0.5, totalProgression: 0.43 } }, progression: 0.43, updatedAt: T0 }],
    sessions: [{ sessionId: 's1', bookId: 'b1', device: 'iphone', startedAt: T0 - 600_000, endedAt: T0, activeSeconds: 540, startProgression: 0.4, endProgression: 0.43, pagesTurned: 12 }],
    annotations: [{
      annotationId: 'a1', bookId: 'b1', kind: 'note', color: 'yellow',
      locator: { href: 'OEBPS/ch1.xhtml', type: 'application/xhtml+xml', locations: { progression: 0.5 }, text: { before: 'The ', highlight: 'spice must flow', after: '.' } },
      text: 'spice must flow', note: 'the whole book in four words', createdAt: T0, updatedAt: T0, deletedAt: null, device: 'iphone', source: 'stacks',
    }],
  }
  const res = await app.request('/api/sync', { method: 'POST', body: JSON.stringify(req) })
  expect(res.status).toBe(200)
  const body = (await res.json()) as SyncResponse
  expect(body.positions).toHaveLength(1)
  expect(body.sessions).toHaveLength(1)
  expect(body.annotations).toHaveLength(1)
  expect(g.titles.get('p1')?.status).toBe('doing')
  writeFileSync(new URL('../../app-fixtures/sync.json', import.meta.url), JSON.stringify({ request: req, response: body }, null, 2) + '\n')
})

test('GET /api/sessions filters by time', async () => {
  store.putSession({ sessionId: 's1', bookId: 'b1', device: 'iphone', startedAt: 1000, endedAt: 2000, activeSeconds: 1, startProgression: 0, endProgression: 0, pagesTurned: 0 })
  store.putSession({ sessionId: 's2', bookId: 'b1', device: 'iphone', startedAt: 9000, endedAt: 9500, activeSeconds: 1, startProgression: 0, endProgression: 0, pagesTurned: 0 })
  const res = await app.request('/api/sessions?from=5000&to=10000')
  expect(((await res.json()) as { sessions: { sessionId: string }[] }).sessions.map((s) => s.sessionId)).toEqual(['s2'])
})

test('POST /api/books adds an uploaded EPUB and starts a lookup', async () => {
  const bytes = zipEpubFolder(makeEpubFolder(join(home, 'up.epub'), { title: 'Neuromancer', author: 'William Gibson' }))
  const res = await app.request('/api/books', { method: 'POST', body: Buffer.from(bytes), headers: { 'x-filename': encodeURIComponent('Neuromancer.epub') } })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { bookId: string; created: boolean; pageTitle: string }
  expect(body).toMatchObject({ created: true, pageTitle: 'Neuromancer' })
  expect(enrichSoon).toEqual([body.bookId])
})

test('POST /api/books with a text file answers 415', async () => {
  const res = await app.request('/api/books', { method: 'POST', body: 'hello', headers: { 'x-filename': 'a.txt' } })
  expect(res.status).toBe(415)
})

test('GET /api/needs-look answers the enricher list', async () => {
  const res = await app.request('/api/needs-look')
  expect(((await res.json()) as { books: unknown[] }).books).toHaveLength(1)
})

test('an unknown book answers 404', async () => {
  expect((await app.request('/api/books/nope/file')).status).toBe(404)
  expect((await app.request('/api/books/nope', { method: 'PATCH', body: '{"status":"done"}' })).status).toBe(404)
})

test('GET /api/health answers ok and the cursor', async () => {
  expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, cursor: store.currentCursor() })
})

test('PATCH while grim is down answers 200 pending with the queued value, and queues the edit once', async () => {
  await app.request('/api/library')
  g.failing = true
  const res = await app.request('/api/books/b1', { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ pending: true, book: { status: 'done', pendingEdit: true } })
  expect(store.pendingGrimoire()).toHaveLength(1)
})

test('PATCH while grim is down before any library load answers 200 pending with no book', async () => {
  g.failing = true
  const res = await app.request('/api/books/b1', { method: 'PATCH', body: JSON.stringify({ rating: 4 }) })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ book: null, pending: true })
})

test('uploading a second file for a book that already has one answers 409', async () => {
  const first = zipEpubFolder(makeEpubFolder(join(home, 'a.epub'), { title: 'Neuromancer', author: 'William Gibson' }))
  const second = zipEpubFolder(makeEpubFolder(join(home, 'b.epub'), { title: 'Neuromancer', author: 'William Gibson', chapters: 3 }))
  await app.request('/api/books', { method: 'POST', body: Buffer.from(first), headers: { 'x-filename': 'n.epub' } })
  const res = await app.request('/api/books', { method: 'POST', body: Buffer.from(second), headers: { 'x-filename': 'n2.epub' } })
  expect(res.status).toBe(409)
})

test('an upload over the size limit is refused with 413 even without a Content-Length', async () => {
  const big = new ReadableStream({
    start(controller) {
      for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(1024))
      controller.close()
    },
  })
  const small = createApp({ grimoire: g, store, editor: new BookEditor({ grimoire: g, store, now: () => T0 }),
    files: { store, grimoire: g, home, fetch: async () => new Response('', { status: 404 }), now: () => T0 },
    enricher: { needsLook: async () => [], match: async () => {}, enrichSoon: () => {} }, now: () => T0, maxUpload: 2048 })
  const res = await small.request('/api/books', { method: 'POST', body: big, headers: { 'x-filename': 'big.epub' }, duplex: 'half' } as RequestInit)
  expect(res.status).toBe(413)
})
