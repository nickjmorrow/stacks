// The JSON API under /api. Tailnet only; nothing here checks who is asking.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import type { EnricherPort } from '../enrich/port.ts'
import { addFile, coverPath, filePath, PageTakenError, UnsupportedFileError, type FilesDeps } from '../files/addFile.ts'
import { GrimError } from '../grimoire/grim.ts'
import { NotFoundError, TitleConflictError } from '../grimoire/grimoire.ts'
import type { Title } from '../shared/title.ts'
import type { BookEditor, GrimoirePort } from '../library/editor.ts'
import { listLibrary, toLibraryBook } from '../library/library.ts'
import type { Store } from '../store/store.ts'
import { applySync } from '../sync/sync.ts'
import { parseRange } from './range.ts'
import { BadRequest, parseBookPatch, parseSyncRequest } from './validate.ts'

export interface AppDeps {
  grimoire: GrimoirePort
  store: Store
  editor: BookEditor
  files: FilesDeps
  enricher: EnricherPort
  now: () => number
  timeZone?: string
  /** Largest upload accepted, in bytes (default 500 MB). */
  maxUpload?: number
}

const MAX_UPLOAD = 500 * 1024 * 1024
const DAY = 24 * 60 * 60 * 1000
const MIME = { epub: 'application/epub+zip', pdf: 'application/pdf' } as const

export function createApp(deps: AppDeps): Hono {
  const { store, grimoire, editor } = deps
  const app = new Hono()

  const bookOr404 = (id: string) => {
    const book = store.getBook(id)
    if (!book) throw new NotFoundError(`no book ${id}`)
    return book
  }

  const json = async (c: Context): Promise<unknown> => {
    try {
      return await c.req.json()
    } catch {
      throw new BadRequest('the body must be JSON')
    }
  }

  app.get('/api/health', (c) => c.json({ ok: true, cursor: store.currentCursor() }))

  /** The last Grimoire page seen for each book, to answer edits while grim is down. */
  const lastSeen = new Map<string, Title>()

  app.get('/api/library', async (c) => {
    const lib = await listLibrary(grimoire, store)
    for (const t of await grimoire.listTitles()) lastSeen.set(t.pageId, t)
    return c.json(lib)
  })

  app.get('/api/tags', async (c) => c.json({ tags: await grimoire.listTags() }))

  app.get('/api/books/:id/file', (c) => {
    const book = bookOr404(c.req.param('id'))
    const path = filePath(deps.files.home, book)
    if (!existsSync(path)) throw new NotFoundError(`the file for ${book.bookId} is missing`)
    const size = statSync(path).size
    const headers: Record<string, string> = { 'content-type': MIME[book.format], etag: `"${book.fileSha256}"`, 'accept-ranges': 'bytes' }
    const range = parseRange(c.req.header('range'), size)
    if (range === 'unsatisfiable') return c.body(null, 416, { ...headers, 'content-range': `bytes */${size}` })
    const { start, end } = range ?? { start: 0, end: size - 1 }
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return c.body(stream, range ? 206 : 200, {
      ...headers,
      'content-length': String(end - start + 1),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    })
  })

  app.get('/api/books/:id/cover', (c) => {
    const book = bookOr404(c.req.param('id'))
    const path = coverPath(deps.files.home, book.bookId)
    if (book.cover === 'generated' || !existsSync(path)) throw new NotFoundError(`no cover for ${book.bookId}`)
    return c.body(readFileSync(path), 200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' })
  })

  app.patch('/api/books/:id', async (c) => {
    const book = bookOr404(c.req.param('id'))
    const { fields, tags } = parseBookPatch(await json(c))
    let pending = false
    if (Object.keys(fields).length > 0) pending = (await editor.setFields(book.bookId, fields)).pending || pending
    if (tags) pending = (await editor.setTags(book.bookId, tags)).pending || pending
    const queued = () => store.pendingGrimoire().filter((i) => i.bookId === book.bookId)
    let page: Title | null
    try {
      page = await grimoire.getTitle(book.pageId)
    } catch (err) {
      // The edit is queued; answer from the last known page (the app's copy) rather than failing a saved edit.
      if (!(err instanceof GrimError) || !pending) throw err
      page = lastSeen.get(book.pageId) ?? null
      if (!page) return c.json({ book: null, pending })
    }
    if (!page) throw new NotFoundError(`the page for ${book.bookId} is gone`)
    lastSeen.set(page.pageId, page)
    return c.json({ book: toLibraryBook(book, page, store.lastReadAt(book.bookId), queued()), pending })
  })

  app.post('/api/sync', async (c) => {
    const req = parseSyncRequest(await json(c))
    return c.json(await applySync({ store, editor, now: deps.now, timeZone: deps.timeZone }, req))
  })

  app.get('/api/sessions', (c) => {
    const to = Number(c.req.query('to') ?? deps.now() + 1)
    const from = Number(c.req.query('from') ?? to - 30 * DAY)
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new BadRequest('from and to must be times in ms')
    return c.json({ sessions: store.sessionsBetween(from, to) })
  })

  app.post('/api/books', async (c) => {
    const max = deps.maxUpload ?? MAX_UPLOAD
    const tooBig = () => c.json({ error: `files over ${Math.round(max / 1024 / 1024)} MB are not accepted` }, 413)
    if (Number(c.req.header('content-length') ?? 0) > max) return tooBig()
    const raw = c.req.header('x-filename')
    if (!raw) throw new BadRequest('the X-Filename header is required')
    let originalName: string
    try {
      originalName = decodeURIComponent(raw)
    } catch {
      throw new BadRequest('X-Filename must be URI-encoded')
    }
    // Read the body in chunks, stopping as soon as it passes the limit (a chunked upload has no Content-Length).
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = c.req.raw.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > max) {
          await reader.cancel()
          return tooBig()
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(Buffer.concat(chunks))
    const res = await addFile(deps.files, { bytes, originalName })
    if (res.created) deps.enricher.enrichSoon(res.bookId)
    return c.json(res, res.created ? 201 : 200)
  })

  app.get('/api/needs-look', async (c) => c.json({ books: await deps.enricher.needsLook() }))

  app.post('/api/books/:id/match', async (c) => {
    const book = bookOr404(c.req.param('id'))
    const body = (await json(c)) as { workId?: unknown }
    if (typeof body?.workId !== 'string' || !/^OL\d+W$/.test(body.workId)) throw new BadRequest('workId must be an Open Library work id like OL45804W')
    await deps.enricher.match(book.bookId, body.workId)
    return c.json({ ok: true })
  })

  app.onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400)
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
    if (err instanceof TitleConflictError || err instanceof PageTakenError) return c.json({ error: err.message }, 409)
    if (err instanceof UnsupportedFileError) return c.json({ error: err.message }, 415)
    console.error(err)
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  })

  return app
}
