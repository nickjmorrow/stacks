import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBooksPage, type Block } from './booksPage.ts'

const page = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/books.json'), 'utf8')) as { blocks: Block[] }
const { books, skipped } = parseBooksPage(page.blocks)
const book = (pageTitle: string) => books.find((b) => b.pageTitle === pageTitle)

describe('parseBooksPage on a sample books page', () => {
  test('section sets status', () => {
    expect(book('Middlemarch')?.fields.status).toBe('doing')
    expect(book('Frankenstein (1818)')?.fields.status).toBe('want')
    expect(book('Dracula (1897)')?.fields.status).toBe('done')
    expect(book('Moby-Dick (1851)')?.fields.status).toBe('dropped')
  })

  test('properties come across, TBD ratings are dropped, x/5 becomes x', () => {
    expect(book('Frankenstein (1818)')?.fields).toEqual({ status: 'want', author: 'Mary Shelley', genre: 'Science Fiction', year: '1818', rec: 'Alice' })
    expect(book('Dracula (1897)')?.fields.rating).toBe('5')
    expect(book('Carmilla (1872)')?.fields.rating).toBe('4')
  })

  test('a year that is not four digits is dropped from the name and fields', () => {
    expect(book('Meditations')?.fields.year).toBeUndefined()
  })

  test('a notes:: line becomes a note', () => {
    expect(book('Moby-Dick (1851)')?.notes[0]).toMatch(/^Didn't like the long whaling chapters/)
  })

  test('inline TODO entries from the "From Priya" section are want, with rec and notes', () => {
    const tm = book('The Time Machine')!
    expect(tm.fields).toMatchObject({ status: 'want', author: 'H. G. Wells', genre: 'Science Fiction', rec: 'Priya' })
    expect(tm.notes[0]).toMatch(/^Series: Standalone/)
    expect(book("The Three Musketeers (d'Artagnan, Book 1)")).toBeDefined()
  })

  test('the topics section is skipped, and category headings are not books', () => {
    expect(skipped.some((s) => /systems thinking/.test(s.text))).toBe(true)
    for (const heading of ['Fiction', 'Nonfiction', 'Science Fiction', 'Adventure', 'Reading']) expect(book(heading)).toBeUndefined()
  })

  test('every book appears once', () => {
    const names = books.map((b) => b.pageTitle.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(books.length).toBe(15)
  })
})
