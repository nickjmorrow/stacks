import type { Title } from '../shared/title.ts'
import { Grimoire, NotANoteError, NotFoundError, TitleConflictError } from './grimoire.ts'
import { grim } from './grim.ts'
import { makeTestGraph } from './testGraph.ts'

let graph: Awaited<ReturnType<typeof makeTestGraph>>
let claudeOpsAfterSetup = 0
const g = new Grimoire()

/** Ops recorded with the given author in the last hour. */
async function ops(author: 'me' | 'claude'): Promise<{ author: string }[]> {
  return (await grim(['changes', '--since', '1h'], { author })) as { author: string }[]
}

async function pageId(title: string): Promise<string> {
  const [row] = (await grim(['query', `select id from pages where title = '${title.replaceAll("'", "''")}'`])) as { id: string }[]
  return row!.id
}

/** Top-level and child block texts of a page, depth first. */
async function blocks(title: string): Promise<string[]> {
  const id = await pageId(title)
  const rows = (await grim(['query', `
    with recursive tree(id, text, path) as (
      select id, text, order_key from blocks where page_id = '${id}' and parent_id is null
      union all
      select b.id, b.text, tree.path || char(1) || b.order_key from blocks b join tree on b.parent_id = tree.id)
    select text from tree order by path`])) as { text: string }[]
  return rows.map((r) => r.text)
}

async function titleNamed(pageTitle: string): Promise<Title | undefined> {
  return (await g.listTitles()).find((t) => t.pageTitle === pageTitle)
}

beforeAll(async () => {
  graph = await makeTestGraph()
  await grim(['create-page', 'The Reading Room'], { author: 'claude' })
  await grim(['append', 'The Reading Room', '- Part 3 is set by the sea.\n- Reread the ending.'], { author: 'claude' })
  await grim(['create-page', 'Hand Edited (1999)'], { author: 'claude' })
  await grim(['append', 'Hand Edited (1999)', '- tags:: [[media]], #Anime\n  Status:: to-play\n  why:: Kai loved it\n  type:: book'], { author: 'claude' })
  claudeOpsAfterSetup = (await ops('claude')).length
})
afterAll(() => graph.cleanup())

describe('setFields', () => {
  test('changes status on Northanger Abbey and leaves the other lines and the note intact', async () => {
    const abbey = (await titleNamed('Northanger Abbey (2021)'))!
    const before = await blocks('Northanger Abbey (2021)')
    const updated = await g.setFields(abbey.pageId, { status: 'doing' })
    expect(updated).toMatchObject({ pageId: abbey.pageId, status: 'doing', rec: 'Claude', appleBooks: 'tt1160419' })
    const after = await blocks('Northanger Abbey (2021)')
    expect(after[0]).toBe(before[0]!.replace('status:: want', 'status:: doing'))
    expect(after.slice(1)).toEqual(before.slice(1))
  })

  test('changes only the one line on a hand-edited block, and removes a field with null', async () => {
    const id = await pageId('Hand Edited (1999)')
    await g.setFields(id, { rating: '4' })
    expect((await blocks('Hand Edited (1999)'))[0]).toBe(
      'tags:: [[media]], #Anime\nStatus:: to-play\nwhy:: Kai loved it\ntype:: book\nrating:: 4')
    const updated = await g.setFields(id, { status: 'done', rating: null })
    expect(updated).toMatchObject({ status: 'done', tags: ['Anime'] })
    expect(updated.rating).toBeUndefined()
    expect((await blocks('Hand Edited (1999)'))[0]).toBe(
      'tags:: [[media]], #Anime\nstatus:: done\nwhy:: Kai loved it\ntype:: book')
  })

  test('refuses a page that is not a title', async () => {
    await expect(g.setFields(await pageId('Watchlist'), { status: 'done' })).rejects.toThrow(/not a title/)
    expect(await blocks('Watchlist')).toEqual(['tags:: [[list]]\ntype:: book'])
  })
})

describe('setTags', () => {
  test('rewrites the tags line with [[media]] first', async () => {
    const id = (await titleNamed('Bright Harbor (2026)'))!.pageId
    const updated = await g.setTags(id, ['Slow Burn', 'media', 'Rainy Day'])
    expect(updated.tags).toEqual(['Slow Burn', 'Rainy Day'])
    expect(await blocks('Bright Harbor (2026)')).toEqual(['type:: book\ntags:: [[media]], [[Slow Burn]], [[Rainy Day]]'])
  })
})

describe('removeFromStacks', () => {
  test('takes only [[media]] out of the tags line; the page and its note remain', async () => {
    const id = (await titleNamed('Northanger Abbey (2021)'))!.pageId
    const before = await blocks('Northanger Abbey (2021)')
    await g.removeFromStacks(id)
    expect(await titleNamed('Northanger Abbey (2021)')).toBeUndefined()
    const after = await blocks('Northanger Abbey (2021)')
    expect(after[0]).toBe(before[0]!.replace('tags:: [[media]], [[Read with Alice]]', 'tags:: [[Read with Alice]]'))
    expect(after.slice(1)).toEqual(before.slice(1))
  })

  test('removes the tags line when [[media]] was the only tag', async () => {
    await g.removeFromStacks(await pageId('The Lantern'))
    expect(await blocks('The Lantern')).toEqual(['Status:: to-play\nrating:: TBD\ntype:: book'])
  })
})

describe('notes', () => {
  test('addNote adds one block with the text as given, and editNote replaces it', async () => {
    const id = (await titleNamed('Bright Harbor (2026)'))!.pageId
    const texts = ['Read it on the train.', '- starts like a bullet', 'two lines\n- second looks like a bullet\n  # and a heading', '-dash first']
    for (const text of texts) {
      const { id: blockId } = await g.addNote(id, text)
      expect(blockId).toMatch(/\S/)
    }
    expect((await blocks('Bright Harbor (2026)')).slice(1)).toEqual(texts)
    const detail = (await g.getTitle(id))!
    await g.editNote(detail.notes[1]!.id, 'now\n- multi\nline')
    expect((await blocks('Bright Harbor (2026)'))[2]).toBe('now\n- multi\nline')
  })

  test('editNote refuses the property block', async () => {
    const detail = (await g.getTitle((await titleNamed('Bright Harbor (2026)'))!.pageId))!
    await expect(g.editNote(detail.propBlockId, 'oops')).rejects.toThrow()
  })
})

describe('createTitle', () => {
  test.each([
    ['Steins;Gate', 2011],
    ['Re:Zero', undefined],
    ["Who's Line Is It Anyway?", undefined],
    ['Airplane!', 1980],
    ['-ish', 2020],
  ])('round-trips %s through listTitles and edits cleanly', async (name, year) => {
    const pageTitle = year ? `${name} (${year})` : name
    const created = await g.createTitle({ name, year, type: 'book', fields: { status: 'want', rec: 'Claude' }, tags: ['Background'] })
    expect(created).toMatchObject({ pageTitle, name, type: 'book', status: 'want', rec: 'Claude', tags: ['Background'] })
    expect(await titleNamed(pageTitle)).toMatchObject({ pageId: created.pageId, name })
    expect(await blocks(pageTitle)).toEqual(['tags:: [[media]], [[Background]]\ntype:: book\nstatus:: want\nrec:: Claude'])
    const edited = await g.setFields(created.pageId, { status: 'done', finished: '2026-10-19' })
    expect(edited).toMatchObject({ name, status: 'done', finished: '2026-10-19' })
  })

  test('adds a props block first on an existing page with prose, leaving the prose alone', async () => {
    const before = await blocks('The Reading Room')
    const created = await g.createTitle({ name: 'The Reading Room', type: 'book', fields: {}, tags: [] })
    expect(created).toMatchObject({ pageTitle: 'The Reading Room', type: 'book', status: 'want' })
    expect(await blocks('The Reading Room')).toEqual(['tags:: [[media]]\ntype:: book', ...before])
  })

  test('adding Name (Year) reuses a yearless page with that name: props first with the year, prose untouched', async () => {
    await grim(['create-page', 'Quiet Waters'], { author: 'claude' })
    await grim(['append', 'Quiet Waters', '- The lighthouse keeper is creepy.\n- Read with Alice.'], { author: 'claude' })
    claudeOpsAfterSetup = (await ops('claude')).length
    const before = await blocks('Quiet Waters')
    const created = await g.createTitle({ name: 'Quiet Waters', year: 2022, type: 'book', fields: { 'apple-books': 'tt11280740' }, tags: [] })
    expect(created).toMatchObject({ pageTitle: 'Quiet Waters', year: 2022, appleBooks: 'tt11280740', type: 'book' })
    expect(await blocks('Quiet Waters')).toEqual(['tags:: [[media]]\ntype:: book\nyear:: 2022\napple-books:: tt11280740', ...before])
    expect(await grim(['query', "select id from pages where title_lower = 'quiet waters (2022)'"])).toEqual([])
  })

  test('a yearless title with a different imdb is a different work, so Name (Year) is created', async () => {
    await grim(['create-page', 'Harbor Lights'], { author: 'claude' })
    await grim(['append', 'Harbor Lights', '- tags:: [[media]]\n  type:: book\n  apple-books:: tt0080274'], { author: 'claude' })
    claudeOpsAfterSetup = (await ops('claude')).length
    const created = await g.createTitle({ name: 'Harbor Lights', year: 2024, type: 'book', fields: { 'apple-books': 'tt2788316' }, tags: [] })
    expect(created).toMatchObject({ pageTitle: 'Harbor Lights (2024)', appleBooks: 'tt2788316' })
    expect(await blocks('Harbor Lights')).toEqual(['tags:: [[media]]\ntype:: book\napple-books:: tt0080274'])
  })

  test('the exact Name (Year) page as a title for a different imdb is refused, with nothing written', async () => {
    const before = await blocks('Harbor Lights (2024)')
    const meOps = (await ops('me')).length
    await expect(g.createTitle({ name: 'Harbor Lights', year: 2024, type: 'book', fields: { 'apple-books': 'tt9999999' }, tags: ['Meta'] }))
      .rejects.toBeInstanceOf(TitleConflictError)
    expect(await blocks('Harbor Lights (2024)')).toEqual(before)
    expect((await ops('me')).length).toBe(meOps)
  })

  test('a yearless title with a different year is a different work, so Name (Year) is created', async () => {
    await grim(['create-page', 'The Night Ferry'], { author: 'claude' })
    await grim(['append', 'The Night Ferry', '- tags:: [[media]]\n  type:: book\n  year:: 1922'], { author: 'claude' })
    claudeOpsAfterSetup = (await ops('claude')).length
    const created = await g.createTitle({ name: 'The Night Ferry', year: 2024, type: 'book', fields: {}, tags: [] })
    expect(created).toMatchObject({ pageTitle: 'The Night Ferry (2024)', year: 2024 })
    expect(await blocks('The Night Ferry')).toEqual(['tags:: [[media]]\ntype:: book\nyear:: 1922'])
  })

  test('merges into an existing first block that already has properties', async () => {
    await grim(['create-page', 'Half Done (2001)'], { author: 'claude' })
    await grim(['append', 'Half Done (2001)', '- why:: Omar\n  tags:: #Anime\n- a note'], { author: 'claude' })
    claudeOpsAfterSetup = (await ops('claude')).length
    const created = await g.createTitle({ name: 'Half Done', year: 2001, type: 'book', fields: { rec: 'Omar' }, tags: ['Meta'] })
    expect(created).toMatchObject({ type: 'book', tags: ['Anime', 'Meta'], rec: 'Omar' })
    expect(await blocks('Half Done (2001)')).toEqual(['why:: Omar\ntags:: [[media]], [[Anime]], [[Meta]]\ntype:: book\nrec:: Omar', 'a note'])
  })
})

test('createTitle finishes a half-done earlier attempt: one props block, first, prose untouched', async () => {
  // State after an insert and one move succeeded and the next move failed: p2, p3, props, p1.
  await grim(['create-page', 'Half Moved'], { author: 'claude' })
  const { blockIds } = (await grim(['append', 'Half Moved', '- p1\n  - p1 child\n- p2\n- p3\n- tags:: [[media]]\n  type:: book'], { author: 'claude' })) as { blockIds: string[] }
  await grim(['move', blockIds[0]!, '--page', 'Half Moved'], { author: 'claude' })
  claudeOpsAfterSetup = (await ops('claude')).length
  const created = await g.createTitle({ name: 'Half Moved', type: 'book', fields: { rec: 'Kai' }, tags: ['Meta'] })
  expect(created).toMatchObject({ pageTitle: 'Half Moved', type: 'book', rec: 'Kai', tags: ['Meta'] })
  expect(await blocks('Half Moved')).toEqual(['tags:: [[media]], [[Meta]]\ntype:: book\nrec:: Kai', 'p1', 'p1 child', 'p2', 'p3'])
})

describe('tag groups', () => {
  test('setTagGroup shows up in listTags, and null removes it', async () => {
    await g.setTagGroup('Read with Alice', 'With')
    expect(await g.listTags()).toContainEqual(expect.objectContaining({ title: 'Read with Alice', group: 'With' }))
    await g.setTagGroup('Brand New Tag', 'Style')
    expect(await g.listTags()).toContainEqual({ title: 'Brand New Tag', group: 'Style', count: 0 })
    await g.setTagGroup('Brand New Tag', null)
    expect(await blocks('Brand New Tag')).toEqual([])
  })

  test('setTagGroup puts the group block before prose on a tag page', async () => {
    await grim(['create-page', 'Cozy'], { author: 'claude' })
    await grim(['append', 'Cozy', '- Blanket movies.\n- Rainy days.'], { author: 'claude' })
    claudeOpsAfterSetup = (await ops('claude')).length
    await g.setTagGroup('Cozy', 'Vibe')
    expect(await blocks('Cozy')).toEqual(['group:: Vibe', 'Blanket movies.', 'Rainy days.'])
  })

  test('setTagGroup(null) keeps blocks indented under the group line', async () => {
    await grim(['create-page', 'Nested'], { author: 'claude' })
    await grim(['append', 'Nested', '- group:: Vibe\n  - a note under it'], { author: 'claude' })
    claudeOpsAfterSetup = (await ops('claude')).length
    await g.setTagGroup('Nested', null)
    expect(await blocks('Nested')).toEqual(['', 'a note under it'])
  })

  test('setTagGroup reuses a group block an interrupted write left mid-page', async () => {
    await grim(['create-page', 'Half Grouped'], { author: 'claude' })
    await grim(['append', 'Half Grouped', '- p1\n- p2\n- group:: Vibe'], { author: 'claude' })
    claudeOpsAfterSetup = (await ops('claude')).length
    await g.setTagGroup('Half Grouped', 'Style')
    expect(await blocks('Half Grouped')).toEqual(['group:: Style', 'p1', 'p2'])
  })

  test('renameGroup moves every tag in the group', async () => {
    await g.setTagGroup('Rainy Day', 'Vibe')
    await g.renameGroup('Vibe', 'Mood')
    const groups = Object.fromEntries((await g.listTags()).map((t) => [t.title, t.group]))
    expect(groups).toMatchObject({ 'Slow Burn': 'Mood', 'Rainy Day': 'Mood', Cozy: 'Mood', 'Read with Alice': 'With' })
  })
})

test('every write is recorded with author me', async () => {
  expect((await ops('me')).length).toBeGreaterThan(0)
  expect((await ops('claude')).length).toBe(claudeOpsAfterSetup)
})

// ---- after the author check above: these write concurrently, with a refused type, and as claude ----

/** A page's top-level block texts in order. */
async function topLevel(title: string): Promise<string[]> {
  const id = await pageId(title)
  const rows = (await grim(['query', `select text from blocks where page_id = '${id}' and parent_id is null order by order_key`])) as { text: string }[]
  return rows.map((r) => r.text)
}

test('two setFields at once on the same title keep both changes', async () => {
  const id = await pageId('Bright Harbor (2026)')
  await Promise.all([g.setFields(id, { status: 'done' }), g.setFields(id, { rating: '5' })])
  expect(await g.getTitle(id)).toMatchObject({ status: 'done', rating: 5 })
}, 20_000)

test('two createTitle at once onto a page with prose add one props block', async () => {
  await grim(['create-page', 'The Kitchen'], { author: 'claude' })
  await grim(['append', 'The Kitchen', '- Busy all night.'], { author: 'claude' })
  const input = { name: 'The Kitchen', type: 'book' as const, fields: {}, tags: [] }
  await Promise.all([g.createTitle(input), g.createTitle(input)])
  expect(await topLevel('The Kitchen')).toEqual(['tags:: [[media]]\ntype:: book', 'Busy all night.'])
}, 20_000)

test('a failed write does not stop later writes', async () => {
  const id = await pageId('Bright Harbor (2026)')
  const failing = g.setFields(await pageId('Watchlist'), { status: 'done' })
  const next = g.setFields(id, { rec: 'Kai' })
  await expect(failing).rejects.toThrow(/not a title/)
  expect(await next).toMatchObject({ rec: 'Kai' })
})

test('setFields refuses a null or unknown type, writing nothing', async () => {
  const id = await pageId('Bright Harbor (2026)')
  const before = await topLevel('Bright Harbor (2026)')
  await expect(g.setFields(id, { type: null })).rejects.toThrow(/type/)
  await expect(g.setFields(id, { type: 'podcast' })).rejects.toThrow(/type/)
  expect(await topLevel('Bright Harbor (2026)')).toEqual(before)
})

test('a Grimoire made with author claude records its writes as claude', async () => {
  const claudeBefore = (await ops('claude')).length
  const meBefore = (await ops('me')).length
  await new Grimoire({ author: 'claude' }).setFields(await pageId('Bright Harbor (2026)'), { rec: 'Omar' })
  expect((await ops('claude')).length).toBeGreaterThan(claudeBefore)
  expect((await ops('me')).length).toBe(meBefore)
})

describe('guarded writes and note errors', () => {
  test('setFields with onlyIfStatus writes nothing when the live status is not allowed', async () => {
    const t = await g.createTitle({ name: 'Guarded', year: 2001, type: 'book', fields: { status: 'dropped' }, tags: [] })
    const after = await g.setFields(t.pageId, { status: 'done', finished: '2026-10-19' }, { onlyIfStatus: ['want', 'doing'] })
    expect(after.status).toBe('dropped')
    expect(after.finished).toBeUndefined()
    await g.setFields(t.pageId, { status: 'want' })
    expect((await g.setFields(t.pageId, { status: 'done' }, { onlyIfStatus: ['want', 'doing'] })).status).toBe('done')
  })

  test('editNote: unknown block is NotFoundError, the property block is NotANoteError', async () => {
    const t = await g.createTitle({ name: 'Noted', year: 2002, type: 'book', fields: {}, tags: [] })
    await expect(g.editNote('no-such-block', 'x')).rejects.toBeInstanceOf(NotFoundError)
    const detail = await g.getTitle(t.pageId)
    await expect(g.editNote(detail!.propBlockId, 'x')).rejects.toBeInstanceOf(NotANoteError)
  })
})

describe('pages that belong to another app', () => {
  test('a book never takes over a page that is already a title of another type (a Hoard movie)', async () => {
    await grim(['create-page', 'Hollow Hill'], { author: 'claude' })
    await grim(['append', 'Hollow Hill', '- tags:: [[media]]\n  type:: movie\n  status:: done'], { author: 'claude' })
    await expect(g.createTitle({ name: 'Hollow Hill', type: 'book', fields: { author: 'A. Writer' }, tags: [] }))
      .rejects.toBeInstanceOf(TitleConflictError)
    expect((await blocks('Hollow Hill'))[0]).toBe('tags:: [[media]]\ntype:: movie\nstatus:: done')
  })
})

describe('pages with a type line but no [[media]] tag', () => {
  test('a page typed as something else (a person page, a removed title of another type) is never adopted', async () => {
    await grim(['create-page', 'Persona'], { author: 'claude' })
    await grim(['append', 'Persona', '- type:: person\n  born:: 1990'], { author: 'claude' })
    const err = await g.createTitle({ name: 'Persona', type: 'book', fields: {}, tags: [] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TitleConflictError)
    expect((err as TitleConflictError).reason).toBe('other-type')
    expect((await blocks('Persona'))[0]).toBe('type:: person\nborn:: 1990')
  })

  test('a same-type title for a different year is a different-work conflict', async () => {
    await g.createTitle({ name: 'Twice', year: 2001, type: 'book', fields: { year: '2001' }, tags: [] })
    const err = await g.createTitle({ name: 'Twice', year: 2001, type: 'book', fields: { year: '2005' }, tags: [] }).catch((e: unknown) => e)
    expect((err as TitleConflictError).reason).toBe('different-work')
  })
})
