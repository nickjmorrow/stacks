import type { FieldKey, MediaType, Title } from '../../src/shared/title.ts'
import { TitleConflictError } from '../../src/grimoire/grimoire.ts'
import { applyImport, type ImportWriter } from './apply.ts'

function fakeWriter() {
  const calls: string[] = []
  const title = (pageId: string) => ({ pageId } as Title)
  const writer: ImportWriter = {
    async createTitle(input: { name: string; year?: number; type: MediaType; fields: Partial<Record<FieldKey, string>>; tags: string[] }) {
      calls.push(`create ${JSON.stringify(input)}`)
      return title('new')
    },
    async setFields(pageId, fields) { calls.push(`fields ${pageId} ${JSON.stringify(fields)}`); return title(pageId) },
  }
  return { writer, calls }
}

describe('applyImport', () => {
  test('creates new books by name and year, keeping year as a field, and updates matched ones', async () => {
    const { writer, calls } = fakeWriter()
    const counts = await applyImport({
      create: [
        { pageTitle: 'Frankenstein (1818)', fields: { status: 'want', author: 'Mary Shelley', year: '1818', 'apple-books': '1' }, tags: [], notes: [], sources: [] },
        { pageTitle: 'Persuasion', fields: { status: 'doing', 'apple-books': '2' }, tags: [], notes: [], sources: [] },
      ],
      update: [{ pageId: 'p-old', fields: { 'apple-books': '3' } }],
      skipped: [],
    }, writer)
    expect(calls).toEqual([
      'create {"name":"Frankenstein","year":1818,"type":"book","fields":{"status":"want","author":"Mary Shelley","year":"1818","apple-books":"1"},"tags":[]}',
      'create {"name":"Persuasion","type":"book","fields":{"status":"doing","apple-books":"2"},"tags":[]}',
      'fields p-old {"apple-books":"3"}',
    ])
    expect(counts).toEqual({ created: 2, updated: 1, failed: [] })
  })

  test('one failing book is reported and the rest still go through', async () => {
    const { writer, calls } = fakeWriter()
    const create = writer.createTitle
    writer.createTitle = async (input) => { if (input.name === 'Bad') throw new Error('conflict'); return create(input) }
    const counts = await applyImport({
      create: [
        { pageTitle: 'Bad', fields: {}, tags: [], notes: [], sources: [] },
        { pageTitle: 'Good', fields: {}, tags: [], notes: [], sources: [] },
      ],
      update: [], skipped: [],
    }, writer)
    expect(counts).toEqual({ created: 1, updated: 0, failed: [{ name: 'Bad', error: 'conflict' }] })
    expect(calls).toHaveLength(1)
  })
})

describe('a page name already used by a Hoard title', () => {
  test('retries as "Name (book)" so the movie page is left alone', async () => {
    const calls: string[] = []
    const writer: ImportWriter = {
      async createTitle(input) {
        if (input.name === 'Hollow Hill') throw new TitleConflictError('Hollow Hill is already something other than a book', 'other-type')
        calls.push(input.name)
        return { pageId: 'x' } as Title
      },
      async setFields(pageId) { return { pageId } as Title },
    }
    const counts = await applyImport({ create: [{ pageTitle: 'Hollow Hill', fields: { status: 'want' }, tags: [], notes: [], sources: [] }], update: [], skipped: [] }, writer)
    expect(calls).toEqual(['Hollow Hill (book)'])
    expect(counts).toEqual({ created: 1, updated: 0, failed: [] })
  })
})

test('a clash with another book (different Apple Books ID) is reported, not renamed', async () => {
  const calls: string[] = []
  const writer: ImportWriter = {
    async createTitle(input) {
      if (input.name === 'Dune') throw new TitleConflictError('Dune is already a title for a different work', 'different-work')
      calls.push(input.name)
      return { pageId: 'x' } as Title
    },
    async setFields(pageId) { return { pageId } as Title },
  }
  const counts = await applyImport({ create: [{ pageTitle: 'Dune', fields: {}, tags: [], notes: [], sources: [] }], update: [], skipped: [] }, writer)
  expect(calls).toEqual([])
  expect(counts.failed).toEqual([{ name: 'Dune', error: 'Dune is already a title for a different work' }])
})
