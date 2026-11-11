import type { Title } from '../../src/shared/title.ts'
import { planImport, type AppleBook } from './plan.ts'

function book(o: Partial<AppleBook> & { assetId: string; title: string }): AppleBook {
  return { progress: 0, finished: false, ...o }
}

function title(o: Partial<Title> & { pageTitle: string }): Title {
  return {
    pageId: 'p-' + o.pageTitle,
    name: o.pageTitle.replace(/ \(\d{4}\)$/, ''),
    type: 'book',
    status: 'want',
    tags: [],
    notesText: '',
    updatedAt: 0,
    createdAt: 0,
    ...o,
  }
}

function asExisting(creates: ReturnType<typeof planImport>['create']): Title[] {
  return creates.map((c) =>
    title({
      pageTitle: c.pageTitle,
      type: 'book',
      status: c.fields.status as Title['status'],
      appleBooks: c.fields['apple-books'],
    }),
  )
}

describe('planImport', () => {
  it('creates a finished book as done', () => {
    const plan = planImport([book({ assetId: 'A1', title: 'Dune', author: 'Frank Herbert', finished: true, progress: 1 })], [])
    expect(plan.create).toHaveLength(1)
    const t = plan.create[0]!
    expect(t.pageTitle).toBe('Dune')
    expect(t.fields).toMatchObject({ status: 'done', author: 'Frank Herbert', 'apple-books': 'A1' })
    expect(t.sources).toEqual(['Apple Books'])
    expect(t.tags).toEqual([])
    expect(t.notes).toEqual([])
  })

  it('creates a book with progress 0.09 as doing, and an unread one as want', () => {
    const plan = planImport([book({ assetId: 'A', title: 'Reading', progress: 0.09 }), book({ assetId: 'B', title: 'Unread' })], [])
    expect(plan.create.map((c) => c.fields.status)).toEqual(['doing', 'want'])
  })

  it('puts the year in the page title and fields', () => {
    const plan = planImport([book({ assetId: 'A', title: 'Dune', year: 1965 })], [])
    expect(plan.create[0]!.pageTitle).toBe('Dune (1965)')
    expect(plan.create[0]!.fields.year).toBe('1965')
  })

  it('leaves a dropped book alone', () => {
    const existing = [title({ pageTitle: 'Dune', status: 'dropped', appleBooks: 'A1' })]
    const plan = planImport([book({ assetId: 'A1', title: 'Dune', finished: true })], existing)
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([])
  })

  it('adds apple-books to a migrated page instead of duplicating it', () => {
    const existing = [title({ pageTitle: 'The Time Machine (1895)', status: 'done', year: 1895 })]
    const plan = planImport([book({ assetId: 'L1', title: 'The Time Machine', author: 'H. G. Wells' })], existing)
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([
      { pageId: existing[0]!.pageId, fields: { 'apple-books': 'L1', author: 'H. G. Wells' } },
    ])
  })

  it('moves status forward only', () => {
    const existing = [
      title({ pageTitle: 'Up', status: 'want', appleBooks: 'U' }),
      title({ pageTitle: 'Back', status: 'done', appleBooks: 'B' }),
    ]
    const plan = planImport(
      [book({ assetId: 'U', title: 'Up', progress: 0.5 }), book({ assetId: 'B', title: 'Back', progress: 0.1 })],
      existing,
    )
    expect(plan.update).toEqual([{ pageId: existing[0]!.pageId, fields: { status: 'doing' } }])
  })

  it('strips Unabridged, Abridged and ISBN suffixes from the page title', () => {
    const plan = planImport(
      [
        book({ assetId: 'A', title: 'Dracula (Unabridged)' }),
        book({ assetId: 'B', title: 'Emma (abridged)' }),
        book({ assetId: 'C', title: 'Ulysses (9780199535675)' }),
      ],
      [],
    )
    expect(plan.create.map((c) => c.pageTitle)).toEqual(['Dracula', 'Emma', 'Ulysses'])
  })

  it('matches titles ignoring punctuation and spacing', () => {
    const existing = [title({ pageTitle: 'Twenty Years After (Musketeers, Book 2)' })]
    const plan = planImport([book({ assetId: 'U', title: 'Twenty Years After (Musketeers Book 2)' })], existing)
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([{ pageId: existing[0]!.pageId, fields: { 'apple-books': 'U' } }])
  })

  it('treats variants of one title as library duplicates', () => {
    const plan = planImport(
      [book({ assetId: 'A', title: 'Dracula' }), book({ assetId: 'B', title: 'Dracula (Unabridged)', progress: 0.5 })],
      [],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.skipped).toHaveLength(1)
  })

  it('keeps the furthest-along of two library duplicates', () => {
    const plan = planImport(
      [book({ assetId: 'D1', title: 'Dracula' }), book({ assetId: 'D2', title: 'Dracula', progress: 0.3 })],
      [],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]!.fields['apple-books']).toBe('D2')
    expect(plan.skipped).toEqual([{ assetId: 'D1', title: 'Dracula', reason: 'duplicate in Apple Books' }])
  })

  it('does not match a year-less name when two book pages share it', () => {
    const existing = [title({ pageTitle: 'X (1990)' }), title({ pageTitle: 'X (2000)' })]
    const plan = planImport([book({ assetId: 'X', title: 'X' })], existing)
    expect(plan.create).toHaveLength(1)
  })

  it('is idempotent on its own output', () => {
    const books = [
      book({ assetId: 'A', title: 'Dune', finished: true }),
      book({ assetId: 'B', title: 'Dracula' }),
      book({ assetId: 'C', title: 'Dracula', progress: 0.2 }),
      book({ assetId: 'D', title: 'Emma', progress: 0.1 }),
    ]
    const first = planImport(books, [])
    const second = planImport(books, asExisting(first.create))
    expect(second.create).toEqual([])
    expect(second.update).toEqual([])
  })

  describe('the same book under two Apple Books items', () => {
    const own = (o: Partial<AppleBook> & { assetId: string; title: string }) => book({ path: `/Books/${o.title}.epub`, ...o })

    it('a Book Store edition with a subtitle joins the page of your own file', () => {
      const plan = planImport([
        own({ assetId: '8A63', title: 'Walden', author: 'Henry David Thoreau' }),
        book({ assetId: 'S1001', title: 'Walden: Or, Life in the Woods', author: 'Bill McKibben & Henry D. Thoreau' }),
      ], [])
      expect(plan.create.map((c) => [c.pageTitle, c.fields['apple-books']])).toEqual([['Walden', '8A63']])
      expect(plan.skipped).toEqual([{ assetId: 'S1001', title: 'Walden: Or, Life in the Woods', reason: 'same book as "Walden"' }])
    })

    it('your own file gets the page even when the Book Store edition is further along, and the page takes the furthest status', () => {
      const plan = planImport([
        book({ assetId: 'S1002', title: 'The Art of War : A New Translation', author: 'Lionel Giles Ph.D. & Sun Tzu', finished: true, progress: 1 }),
        own({ assetId: 'D71C', title: 'The Art of War', author: 'Sun Tzu' }),
      ], [])
      expect(plan.create).toHaveLength(1)
      expect(plan.create[0]!.fields).toMatchObject({ 'apple-books': 'D71C', status: 'done' })
    })

    it('matches a page already in Grimoire by main title and author', () => {
      const existing = [title({ pageTitle: 'Common Sense', author: 'Thomas Paine', year: 1776 })]
      const plan = planImport([
        book({ assetId: 'S1003', title: 'Common Sense : Addressed to the Inhabitants of America', author: 'Thomas Paine', progress: 0.5 }),
        own({ assetId: 'C7FE', title: 'Common Sense', author: 'Thomas Paine' }),
      ], existing)
      expect(plan.create).toEqual([])
      expect(plan.update).toEqual([{ pageId: 'p-Common Sense', fields: { 'apple-books': 'C7FE', status: 'doing' } }])
      expect(plan.skipped.map((s) => s.reason)).toEqual(['same book as "Common Sense"'])
    })

    it('different authors are different books', () => {
      const plan = planImport([
        own({ assetId: 'F1', title: 'Utopia', author: 'Thomas More' }),
        book({ assetId: 'F2', title: 'Utopia: A Novel', author: 'Someone Else' }),
      ], [])
      expect(plan.create.map((c) => c.pageTitle)).toEqual(['Utopia', 'Utopia: A Novel'])
    })

    it('your own file with a year and a Book Store edition with a subtitle still share one page', () => {
      const plan = planImport([
        own({ assetId: '8A63', title: 'Walden', author: 'Henry David Thoreau', year: 2010 }),
        book({ assetId: 'S1001', title: 'Walden: Or, Life in the Woods', author: 'Henry David Thoreau', year: 2011 }),
      ], [])
      expect(plan.create.map((c) => c.pageTitle)).toEqual(['Walden (2010)'])
    })
  })
})
