import { describe, expect, it } from 'vitest'
import { LookupUnavailableError } from './lookupError.ts'
import { OpenLibraryClient, firstSentence } from './openLibrary.ts'

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    const path = url.replace('https://openlibrary.org', '').split('?')[0]!
    return path in routes ? new Response(JSON.stringify(routes[path])) : new Response('{}', { status: 404 })
  }
  return { fetch, calls }
}

describe('OpenLibraryClient', () => {
  it('maps search results', async () => {
    const f = fakeFetch({ '/search.json': { numFound: 1, docs: [{ key: '/works/OL45804W', title: 'Fantastic Mr Fox', author_name: ['Roald Dahl'], first_publish_year: 1970 }] } })
    const r = await new OpenLibraryClient({ fetch: f.fetch }).search('book', 'Fantastic Mr Fox')
    expect(r).toEqual([{ source: 'openlibrary', id: 'OL45804W', name: 'Fantastic Mr Fox', year: 1970, detail: 'Roald Dahl' }])
  })

  it('maps work details (object description, author lookup)', async () => {
    const f = fakeFetch({
      '/works/OL45804W.json': {
        title: 'X', description: { type: '/type/text', value: 'A fox outwits three farmers. Then more happens.\n\n([source][1])' },
        authors: [{ author: { key: '/authors/OL34184A' } }], first_publish_date: 'October 1970',
      },
      '/authors/OL34184A.json': { name: 'Roald Dahl' },
    })
    expect(await new OpenLibraryClient({ fetch: f.fetch }).details('book', 'OL45804W')).toEqual({
      author: 'Roald Dahl', year: '1970', summary: 'A fox outwits three farmers.',
    })
  })

  it('accepts a string description and tolerates a missing work', async () => {
    const f = fakeFetch({ '/works/OL1W.json': { description: 'Short and sweet' } })
    const c = new OpenLibraryClient({ fetch: f.fetch })
    expect(await c.details('book', 'OL1W')).toEqual({ summary: 'Short and sweet' })
    expect(await c.details('book', 'OL2W')).toEqual({})
  })

  it('firstSentence splits on . ! ?', () => {
    expect(firstSentence('Hello there! More.')).toBe('Hello there!')
    expect(firstSentence('Is it? Yes.')).toBe('Is it?')
    expect(firstSentence('A fox. Then more.')).toBe('A fox.')
  })

  it('firstSentence does not cut after abbreviations', () => {
    expect(firstSentence('Mr. Fox outwits the farmers. Then more.')).toBe('Mr. Fox outwits the farmers.')
    expect(firstSentence('Dr. Who meets St. Paul vs. the clock, e.g. today. Next.')).toBe('Dr. Who meets St. Paul vs. the clock, e.g. today.')
  })

  it('firstSentence does not cut after single-letter initials', () => {
    expect(firstSentence('J. R. R. Tolkien wrote it. Then more.')).toBe('J. R. R. Tolkien wrote it.')
  })

  it('throws unavailable on 503, network error and non-JSON 200', async () => {
    const c503 = new OpenLibraryClient({ fetch: async () => new Response('{}', { status: 503 }) })
    await expect(c503.search('book', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
    const cNet = new OpenLibraryClient({ fetch: async () => { throw new TypeError('fetch failed') } })
    await expect(cNet.details('book', 'OL1W')).rejects.toBeInstanceOf(LookupUnavailableError)
    const cHtml = new OpenLibraryClient({ fetch: async () => new Response('<html>oops</html>') })
    await expect(cHtml.search('book', 'x')).rejects.toBeInstanceOf(LookupUnavailableError)
  })
})

describe('OpenLibraryClient for Stacks', () => {
  it('byIsbn parses work, edition, cover, pages and publisher', async () => {
    const f = fakeFetch({ '/isbn/9780441013593.json': { key: '/books/OL1M', works: [{ key: '/works/OL893415W' }], covers: [123], number_of_pages: 604, publishers: ['Ace'] } })
    expect(await new OpenLibraryClient({ fetch: f.fetch }).byIsbn('9780441013593')).toEqual({
      workId: 'OL893415W', editionId: 'OL1M', coverId: 123, pageCount: 604, publisher: 'Ace',
    })
  })

  it('byIsbn answers null on 404', async () => {
    expect(await new OpenLibraryClient({ fetch: fakeFetch({}).fetch }).byIsbn('9780441013593')).toBeNull()
  })

  it('searchBook sends title and author', async () => {
    const f = fakeFetch({ '/search.json': { docs: [] } })
    await new OpenLibraryClient({ fetch: f.fetch }).searchBook('Dune', 'Frank Herbert')
    expect(f.calls[0]).toBe('https://openlibrary.org/search.json?title=Dune&author=Frank%20Herbert&limit=10')
  })

  it('work returns fields and subjects', async () => {
    const f = fakeFetch({ '/works/OL1W.json': { description: 'One. Two.', first_publish_date: '1990', subjects: ['Psychology'], authors: [] } })
    expect(await new OpenLibraryClient({ fetch: f.fetch }).work('OL1W')).toEqual({ fields: { year: '1990', summary: 'One.' }, subjects: ['Psychology'] })
  })
})
