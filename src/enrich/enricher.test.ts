import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeGrimoire, title } from '../library/fakeGrimoire.ts'
import { OpenLibraryClient } from '../lookup/openLibrary.ts'
import { Store } from '../store/store.ts'
import { bookRow } from '../store/testRows.ts'
import { Enricher } from './enricher.ts'
import { genreFromSubjects } from './genres.ts'

const HOUR = 60 * 60 * 1000

describe('genreFromSubjects', () => {
  test('science fiction', () => expect(genreFromSubjects(['Science fiction', 'Fiction'])).toBe('Science Fiction'))
  test('two matches are joined', () => expect(genreFromSubjects(['Psychology', 'Self-help'])).toBe('Psychology, Self-Help'))
  test('at most two', () => expect(genreFromSubjects(['Horror', 'Fantasy', 'Science fiction'])).toBe('Science Fiction, Fantasy'))
  test('plain fiction only when nothing else matches', () => expect(genreFromSubjects(['Fiction', 'Large type books'])).toBe('Fiction'))
  test('nothing', () => expect(genreFromSubjects([])).toBeUndefined())
})

type Routes = Record<string, unknown>
function fakeFetch(routes: Routes) {
  let down = false
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    if (down) throw new TypeError('fetch failed')
    if (url.startsWith('https://covers.openlibrary.org')) return new Response('', { status: 404 })
    const u = new URL(url)
    const key = u.pathname === '/search.json' ? `/search.json?${u.searchParams.get('title')}` : u.pathname
    return key in routes ? new Response(JSON.stringify(routes[key])) : new Response('{}', { status: 404 })
  }
  return { fetch, calls, setDown: (d: boolean) => { down = d } }
}

const DUNE_WORK = {
  description: 'Set on the desert planet Arrakis, Dune is the story of Paul Atreides. More follows.',
  authors: [{ author: { key: '/authors/OL79034A' } }], first_publish_date: '1965', subjects: ['Science fiction', 'Fiction'],
}
const ROUTES: Routes = {
  '/isbn/9780441013593.json': { key: '/books/OL1M', works: [{ key: '/works/OL893415W' }], covers: [123], number_of_pages: 604, publishers: ['Ace'] },
  '/works/OL893415W.json': DUNE_WORK,
  '/authors/OL79034A.json': { name: 'Frank Herbert' },
}

let home: string
let store: Store
let g: FakeGrimoire
let now: number
let ol: ReturnType<typeof fakeFetch>
let enricher: Enricher
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stacks-enrich-'))
  store = new Store(':memory:')
  g = new FakeGrimoire([title({ pageId: 'p1', pageTitle: 'Dune' })])
  now = 1_000_000
  ol = fakeFetch(ROUTES)
  const lookup = new OpenLibraryClient({ fetch: ol.fetch })
  enricher = new Enricher({ store, grimoire: g, lookup, files: { store, grimoire: g, home, fetch: ol.fetch, now: () => now }, now: () => now })
})
afterEach(() => {
  store.close()
  rmSync(home, { recursive: true, force: true })
})

test('a book with an ISBN gets author, year, genre and summary, and is done', async () => {
  store.insertBook(bookRow({ publisher: null, pageCount: null, olWork: null, olEdition: null }))
  expect(await enricher.runOnce()).toEqual({ done: 1, needsLook: 0, failed: 0 })
  expect(g.titles.get('p1')).toMatchObject({
    author: 'Frank Herbert', year: 1965, genre: ['Science Fiction'], summary: 'Set on the desert planet Arrakis, Dune is the story of Paul Atreides.',
  })
  expect(store.getBook('b1')).toMatchObject({ lookupState: 'done', olWork: 'OL893415W', olEdition: 'OL1M', pageCount: 604, publisher: 'Ace', lookupTriedAt: now })
})

test('a value already on the page is never overwritten', async () => {
  g.titles.set('p1', title({ pageId: 'p1', pageTitle: 'Dune', author: 'F. Herbert', summary: 'My own summary.' }))
  store.insertBook(bookRow())
  await enricher.runOnce()
  expect(g.titles.get('p1')).toMatchObject({ author: 'F. Herbert', summary: 'My own summary.', year: 1965 })
})

test('without an ISBN, one clear title and author match is accepted', async () => {
  ROUTES['/search.json?Dune'] = { docs: [
    { key: '/works/OL893415W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965 },
    { key: '/works/OL2W', title: 'Dune Messiah', author_name: ['Frank Herbert'] },
  ] }
  g.titles.set('p1', title({ pageId: 'p1', pageTitle: 'Dune', author: 'Frank Herbert' }))
  store.insertBook(bookRow({ isbn: null }))
  expect(await enricher.runOnce()).toEqual({ done: 1, needsLook: 0, failed: 0 })
  expect(store.getBook('b1')?.olWork).toBe('OL893415W')
})

test('two same-title results put the book in Needs a look, with candidates', async () => {
  ROUTES['/search.json?Utopia'] = { docs: [
    { key: '/works/OL10W', title: 'Utopia', author_name: ['Thomas More'], first_publish_year: 1990 },
    { key: '/works/OL11W', title: 'Utopia', author_name: ['Someone Else'], first_publish_year: 2010 },
  ] }
  g.titles.set('p1', title({ pageId: 'p1', pageTitle: 'Utopia' }))
  store.insertBook(bookRow({ isbn: null }))
  expect(await enricher.runOnce()).toEqual({ done: 0, needsLook: 1, failed: 0 })
  const list = await enricher.needsLook()
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ bookId: 'b1', pageTitle: 'Utopia' })
  expect(list[0]?.candidates.map((c) => c.id)).toEqual(['OL10W', 'OL11W'])
})

test('match() applies the picked work and marks the book done', async () => {
  ROUTES['/works/OL10W.json'] = { description: 'About an ideal island.', first_publish_date: '1990', subjects: ['Psychology'], authors: [] }
  g.titles.set('p1', title({ pageId: 'p1', pageTitle: 'Utopia' }))
  store.insertBook(bookRow({ isbn: null, lookupState: 'needs_look' }))
  await enricher.match('b1', 'OL10W')
  expect(g.titles.get('p1')).toMatchObject({ year: 1990, genre: ['Psychology'], summary: 'About an ideal island.' })
  expect(store.getBook('b1')).toMatchObject({ lookupState: 'done', olWork: 'OL10W' })
})

test('Open Library down marks the book failed, tried again after an hour', async () => {
  store.insertBook(bookRow())
  ol.setDown(true)
  expect(await enricher.runOnce()).toEqual({ done: 0, needsLook: 0, failed: 1 })
  expect(store.getBook('b1')?.lookupState).toBe('failed')
  ol.setDown(false)
  now += HOUR / 2
  expect(await enricher.runOnce()).toEqual({ done: 0, needsLook: 0, failed: 0 })
  now += HOUR
  expect(await enricher.runOnce()).toEqual({ done: 1, needsLook: 0, failed: 0 })
})

test('enrichSoon looks one book up without waiting', async () => {
  store.insertBook(bookRow())
  enricher.enrichSoon('b1')
  await enricher.idle()
  expect(store.getBook('b1')?.lookupState).toBe('done')
})

test('several works with the same title and author take Open Library\'s top match', async () => {
  ROUTES['/search.json?Dracula'] = { docs: [
    { key: '/works/OL85892W', title: 'Dracula', author_name: ['Bram Stoker'], first_publish_year: 1897 },
    { key: '/works/OL99W', title: 'Dracula', author_name: ['Bram Stoker'], first_publish_year: 1901 },
  ] }
  ROUTES['/works/OL85892W.json'] = { description: 'A vampire story.', first_publish_date: '1897', subjects: ['Horror'], authors: [] }
  g.titles.set('p1', title({ pageId: 'p1', pageTitle: 'Dracula', author: 'Stoker, Bram' }))
  store.insertBook(bookRow({ isbn: null }))
  expect(await enricher.runOnce()).toEqual({ done: 1, needsLook: 0, failed: 0 })
  expect(store.getBook('b1')?.olWork).toBe('OL85892W')
})

test('a series note and subtitle on the page name are ignored when searching and matching', async () => {
  ROUTES['/search.json?Twenty Years After'] = { docs: [{ key: '/works/OL5W', title: 'Twenty Years After', author_name: ['Alexandre Dumas'] }] }
  ROUTES['/works/OL5W.json'] = { first_publish_date: '2016', subjects: ['Fantasy'], authors: [] }
  g.titles.set('p1', title({ pageId: 'p1', pageTitle: 'Twenty Years After (Musketeers, Book 2)', author: 'Alexandre Dumas' }))
  store.insertBook(bookRow({ isbn: null }))
  expect(await enricher.runOnce()).toEqual({ done: 1, needsLook: 0, failed: 0 })
})
