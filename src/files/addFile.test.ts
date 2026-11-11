import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEpubFolder, minimalPdf } from '../../test/fixtures/makeEpub.ts'
import { zipEpubFolder } from '../epub/zip.ts'
import { FakeGrimoire, title } from '../library/fakeGrimoire.ts'
import { Store } from '../store/store.ts'
import { addFile, NoPageError, PageTakenError, UnsupportedFileError, type FilesDeps } from './addFile.ts'

let home: string
let store: Store
let g: FakeGrimoire
let deps: FilesDeps
let added: string[]
const offline = async (): Promise<Response> => new Response('', { status: 404 })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stacks-home-'))
  store = new Store(':memory:')
  g = new FakeGrimoire()
  added = []
  deps = { store, grimoire: g, home, fetch: offline, now: () => 1000, onAdded: (id) => added.push(id) }
})
afterEach(() => {
  store.close()
  rmSync(home, { recursive: true, force: true })
})

const epub = (opts: Parameters<typeof makeEpubFolder>[1] = {}) =>
  zipEpubFolder(makeEpubFolder(join(home, `src-${Math.random()}.epub`), opts))

test('adds an EPUB, creates its page and saves the cover', async () => {
  const bytes = epub({ title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', cover: true })
  const res = await addFile(deps, { bytes, originalName: 'Dune.epub' })
  expect(res).toMatchObject({ created: true, pageTitle: 'Dune' })
  const row = store.getBook(res.bookId)!
  expect(row).toMatchObject({ format: 'epub', isbn: '9780441013593', cover: 'embedded', lookupState: 'pending', addedAt: 1000, originalName: 'Dune.epub' })
  expect(readFileSync(join(home, 'files', `${res.bookId}.epub`))).toEqual(Buffer.from(bytes))
  expect(existsSync(join(home, 'covers', `${res.bookId}.jpg`))).toBe(true)
  expect(g.titles.get(row.pageId)).toMatchObject({ author: 'Frank Herbert' })
  expect(added).toEqual([res.bookId])
})

test('the same bytes twice are added once', async () => {
  const bytes = epub({ title: 'Dune' })
  const first = await addFile(deps, { bytes, originalName: 'Dune.epub' })
  const second = await addFile(deps, { bytes, originalName: 'Dune copy.epub' })
  expect(second).toEqual({ bookId: first.bookId, created: false, pageTitle: 'Dune' })
  expect(store.listBooks()).toHaveLength(1)
})

test('finds the page by appleBooksId', async () => {
  g.titles.set('p9', title({ pageId: 'p9', pageTitle: 'Dune (1965)', appleBooks: 'AB9' }))
  const res = await addFile(deps, { bytes: epub({ title: 'Dune' }), originalName: 'x.epub', appleBooksId: 'AB9' })
  expect(store.getBook(res.bookId)).toMatchObject({ pageId: 'p9', appleBooksId: 'AB9' })
  expect(g.calls.filter((c) => c.op === 'createTitle')).toEqual([])
})

test('createPage false with no page found throws NoPageError and adds nothing', async () => {
  await expect(addFile(deps, { bytes: epub({ title: 'Dune' }), originalName: 'x.epub', appleBooksId: 'AB0', createPage: false }))
    .rejects.toBeInstanceOf(NoPageError)
  expect(store.listBooks()).toEqual([])
})

test('a PDF takes its page name from the file name', async () => {
  const res = await addFile(deps, {
    bytes: new Uint8Array(minimalPdf()),
    originalName: 'Field Notes on Birds_ A Beginners GuideNature Series Book 3 - Doe Jane 1.pdf',
  })
  expect(res.pageTitle).toBe('Field Notes on Birds: A Beginners GuideNature Series Book 3 - Doe Jane 1')
  expect(store.getBook(res.bookId)).toMatchObject({ format: 'pdf', cover: 'generated' })
})

test('an EPUB without a title keeps the accents of its file name', async () => {
  const res = await addFile(deps, { bytes: epub(), originalName: 'Cien años de soledad.epub' })
  expect(res.pageTitle).toBe('Cien años de soledad')
})

test('a clash with another type uses "Name (book)"', async () => {
  g.otherType.add('Hollow Hill')
  const res = await addFile(deps, { bytes: epub({ title: 'Hollow Hill' }), originalName: 'r.epub' })
  expect(res.pageTitle).toBe('Hollow Hill (book)')
})

test('an unknown file type is refused', async () => {
  await expect(addFile(deps, { bytes: new TextEncoder().encode('just text'), originalName: 'notes.txt' }))
    .rejects.toBeInstanceOf(UnsupportedFileError)
})

test('an Open Library cover is used when the EPUB has none', async () => {
  deps.fetch = async () => new Response(new Uint8Array(readFileSync(new URL('../../test/fixtures/cover.jpg', import.meta.url))), { status: 200 })
  const res = await addFile(deps, { bytes: epub({ title: 'Dune', isbn: '9780441013593' }), originalName: 'd.epub' })
  expect(store.getBook(res.bookId)?.cover).toBe('openlibrary')
})

test('an upload named like one of the owner\'s own notes pages gets "Name (book)" and leaves the notes page alone', async () => {
  g.plainPages.add('Utopia')
  const res = await addFile(deps, { bytes: epub({ title: 'Utopia', author: 'Thomas More' }), originalName: 'Utopia.epub' })
  expect(res.pageTitle).toBe('Utopia (book)')
})

test('an upload of a book that already has a page with a year and the same author reuses that page', async () => {
  g.titles.set('p7', title({ pageId: 'p7', pageTitle: 'Dune (1965)', author: 'Frank Herbert' }))
  const res = await addFile(deps, { bytes: epub({ title: 'Dune: Deluxe Edition', author: 'Herbert, Frank' }), originalName: 'Dune.epub' })
  expect(res).toMatchObject({ created: true, pageTitle: 'Dune (1965)' })
  expect(store.getBook(res.bookId)?.pageId).toBe('p7')
  expect(g.calls.filter((c) => c.op !== 'getTitle')).toEqual([])
})

test('two uploads of the same bytes at once add one book and one file', async () => {
  const bytes = epub({ title: 'Dune' })
  const [a, b] = await Promise.all([addFile(deps, { bytes, originalName: 'Dune.epub' }), addFile(deps, { bytes, originalName: 'Dune.epub' })])
  expect(a.bookId).toBe(b.bookId)
  expect([a.created, b.created].sort()).toEqual([false, true])
  expect(store.listBooks()).toHaveLength(1)
  expect(readdirSync(join(home, 'files'))).toHaveLength(1)
})

test('a second file for a book that already has one is refused and leaves no file', async () => {
  await addFile(deps, { bytes: epub({ title: 'Dune', author: 'Frank Herbert' }), originalName: 'Dune.epub' })
  await expect(addFile(deps, { bytes: epub({ title: 'Dune', author: 'Frank Herbert', chapters: 3 }), originalName: 'Dune 2.epub' }))
    .rejects.toBeInstanceOf(PageTakenError)
  expect(readdirSync(join(home, 'files'))).toHaveLength(1)
})
