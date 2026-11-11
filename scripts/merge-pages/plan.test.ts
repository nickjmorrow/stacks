import type { ExistingPage } from '../lib/live.ts'
import type { AppleBook } from '../import-apple-books/appleBooks.ts'
import { planMerges, type MergeLists } from './plan.ts'

const book = (assetId: string, title: string, over: Partial<AppleBook> = {}): AppleBook =>
  ({ assetId, title, progress: 0, finished: false, ...over })

const LISTS: MergeLists = {
  merges: ['Walden', 'Meditations', 'The Prince', 'Beowulf'],
  separate: [
    { page: 'Utopia (1516)', match: 'Utopia', year: 1516 },
    { page: 'Leviathan (1651)', match: 'Leviathan', year: 1651 },
  ],
}

const LIBRARY: AppleBook[] = [
  book('A1', 'Walden', { author: 'Henry David Thoreau', finished: true, progress: 1 }),
  book('A2', 'Meditations: A New Translation', { author: 'Marcus Aurelius', progress: 0.3 }),
  book('A3', 'The Prince', { author: 'Niccolo Machiavelli', progress: 0.1 }),
  book('A4', 'Beowulf', { author: 'Anonymous' }),
  book('A5', 'Utopia', { author: 'Thomas More' }),
  book('A6', 'Leviathan (Unabridged)', { author: 'Thomas Hobbes' }),
  book('A7', 'Dune'),
]
const page = (title: string): [string, ExistingPage] => [title.toLowerCase(), { title, isTitle: false }]
const EXISTING = new Map([
  page('walden'), page('Meditations'), page('the prince'),
  page('Beowulf'), page('utopia'), page('leviathan'),
])

test('finds all four merges and both separates', () => {
  const { plans, missing, skipped } = planMerges(LIBRARY, EXISTING, LISTS)
  expect(missing).toEqual([])
  expect(skipped).toEqual([])
  expect(plans).toEqual([
    { action: 'merge', page: 'walden', assetId: 'A1', fields: { author: 'Henry David Thoreau', 'apple-books': 'A1', status: 'done' } },
    { action: 'merge', page: 'Meditations', assetId: 'A2', fields: { author: 'Marcus Aurelius', 'apple-books': 'A2', status: 'doing' } },
    { action: 'merge', page: 'the prince', assetId: 'A3', fields: { author: 'Niccolo Machiavelli', 'apple-books': 'A3', status: 'doing' } },
    { action: 'merge', page: 'Beowulf', assetId: 'A4', fields: { author: 'Anonymous', 'apple-books': 'A4', status: 'want' } },
    { action: 'separate', page: 'Utopia (1516)', assetId: 'A5', fields: { author: 'Thomas More', 'apple-books': 'A5', status: 'want', year: '1516' } },
    { action: 'separate', page: 'Leviathan (1651)', assetId: 'A6', fields: { author: 'Thomas Hobbes', 'apple-books': 'A6', status: 'want', year: '1651' } },
  ])
})

test('a page or book that is not there is reported as missing', () => {
  const { plans, missing } = planMerges(LIBRARY.filter((b) => b.assetId !== 'A4'), new Map([...EXISTING].filter(([k]) => k !== 'utopia')), LISTS)
  expect(plans.map((p) => p.page)).not.toContain('Beowulf')
  expect(missing).toEqual(['Beowulf: no Apple Books item', 'Utopia: no page named Utopia'])
})

test('a page that is already a book page (from the migration) is left alone', () => {
  const existing = new Map(EXISTING)
  existing.set('meditations', { title: 'Meditations', isTitle: true })
  const { plans, skipped } = planMerges(LIBRARY, existing, LISTS)
  expect(plans.map((p) => p.page)).not.toContain('Meditations')
  expect(skipped).toEqual(['Meditations: already a book page'])
})

test('your own file is preferred over a Book Store item with the same name', () => {
  const library = [book('S1', 'Beowulf', { author: 'Anonymous' }), book('T1', 'Beowulf', { author: 'Anonymous', path: '/Books/Beowulf.epub' })]
  expect(planMerges(library, EXISTING, LISTS).plans.find((p) => p.page === 'Beowulf')?.assetId).toBe('T1')
})
