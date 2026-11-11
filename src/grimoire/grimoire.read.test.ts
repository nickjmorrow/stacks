import { Grimoire } from './grimoire.ts'
import { grim, GrimError } from './grim.ts'
import { makeTestGraph } from './testGraph.ts'

let graph: Awaited<ReturnType<typeof makeTestGraph>>
const g = new Grimoire()

beforeAll(async () => { graph = await makeTestGraph() })
afterAll(() => graph.cleanup())

describe('listTitles', () => {
  test('returns exactly the pages tagged [[media]] with a type', async () => {
    const titles = await g.listTitles()
    expect(titles.map((t) => t.pageTitle).sort()).toEqual(['Bright Harbor (2026)', 'Northanger Abbey (2021)', 'The Lantern'])
  })

  test('reads properties, tags, year and notes', async () => {
    const abbey = (await g.listTitles()).find((t) => t.pageTitle === 'Northanger Abbey (2021)')!
    expect(abbey).toMatchObject({
      name: 'Northanger Abbey', type: 'book', status: 'want', tags: ['Read with Alice'], year: 2021,
      rec: 'Claude', appleBooks: 'tt1160419', genre: ['Action', 'Adventure', 'Drama'],
    })
    expect(abbey.rating).toBeUndefined()
    expect(abbey.notesText).toContain('The bath chapters are')
    expect(abbey.updatedAt).toBeGreaterThan(0)
    expect(abbey.createdAt).toBeGreaterThan(0)
  })

  test('accepts tags after type and legacy keys and values', async () => {
    const titles = await g.listTitles()
    expect(titles.find((t) => t.pageTitle === 'Bright Harbor (2026)')).toMatchObject({ type: 'book', year: 2026, tags: [] })
    const medium = titles.find((t) => t.pageTitle === 'The Lantern')!
    expect(medium).toMatchObject({ name: 'The Lantern', type: 'book', status: 'want' })
    expect(medium.rating).toBeUndefined()
    expect(medium.year).toBeUndefined()
  })
})

describe('getTitle', () => {
  test('returns the property block id and the notes', async () => {
    const abbey = (await g.listTitles()).find((t) => t.pageTitle === 'Northanger Abbey (2021)')!
    const detail = (await g.getTitle(abbey.pageId))!
    expect(detail.pageTitle).toBe('Northanger Abbey (2021)')
    expect(detail.propBlockId).toMatch(/\S/)
    expect(detail.notes).toEqual([{ id: expect.any(String), text: expect.stringContaining('The bath chapters are') }])
  })

  test('is null for a missing page and for a page that is not a title', async () => {
    expect(await g.getTitle('no-such-page')).toBeNull()
    const [row] = (await grim(['query', "select id from pages where title = 'Watchlist'"])) as { id: string }[]
    expect(await g.getTitle(row!.id)).toBeNull()
  })
})

describe('listTags', () => {
  test('lists tags used by titles and tag pages with a group, without media', async () => {
    const tags = await g.listTags()
    expect(tags).toContainEqual({ title: 'Slow Burn', group: 'Vibe', count: 0 })
    expect(tags).toContainEqual({ title: 'Read with Alice', count: 1 })
    expect(tags.map((t) => t.title.toLowerCase())).not.toContain('media')
  })
})

describe('grim', () => {
  test('passes text starting with "-" as text, not as an option', async () => {
    for (const title of ['-ish (2020)', '--draft', '-h']) await grim(['create-page', title], { author: 'claude' })
    const rows = (await grim(['query', "select title from pages where title like '-%' order by title"])) as { title: string }[]
    expect(rows.map((r) => r.title)).toEqual(['--draft', '-h', '-ish (2020)'])
  })

  test('passes an option value starting with "-" to the option', async () => {
    await grim(['create-page', '-dashed (2019)'], { author: 'claude' })
    const { blockIds } = (await grim(['insert', '--page', '-dashed (2019)', 'first note'], { author: 'claude' })) as { blockIds: string[] }
    await grim(['insert', '--after', blockIds[0]!, '--draft'], { author: 'claude' })
    const rows = (await grim(['query', `
      select b.text from blocks b join pages p on p.id = b.page_id
      where p.title = '-dashed (2019)' order by b.order_key`])) as { text: string }[]
    expect(rows.map((r) => r.text)).toEqual(['first note', '--draft'])
  })

  test('a failing command throws GrimError with grim\'s message', async () => {
    await expect(grim(['query', 'select bogus'])).rejects.toThrow(GrimError)
    await expect(grim(['query', 'select bogus'])).rejects.toThrow(/no such column/)
  })
})
