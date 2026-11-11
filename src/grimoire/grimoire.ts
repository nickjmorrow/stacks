// Title pages read from and written to Grimoire through grim.
// The page format is docs/title-page-format.md.

import { MEDIA_TAG, MEDIA_TYPES, type FieldKey, type MediaType, type Status, type Title } from '../shared/title.ts'
import { normalizeRating, normalizeStatus, parseProps, parseTagLine, setProp, splitPageTitle, tagLine } from '../shared/titleFormat.ts'
import { grim, GrimError } from './grim.ts'

/** A write that only happens if, inside the write queue, the page's live status is one of these. */
export interface SetFieldsOptions { onlyIfStatus?: Status[] }

/** A block or page that doesn't exist. The API answers 404. */
export class NotFoundError extends Error {}
/** A note edit aimed at something that isn't a note (the property block). The API answers 400. */
export class NotANoteError extends Error {}

/** Who grim records as the author of a write. */
type As = { author: 'me' | 'claude' }

/**
 * Every write in this process runs one at a time, in call order: each re-reads a page and then
 * edits it, so two at once could lose one change or add a second property block. A failed write
 * doesn't stop the ones queued after it.
 */
let writeQueue: Promise<unknown> = Promise.resolve()
function serially<T>(write: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(write)
  writeQueue = run.catch(() => {})
  return run
}

export interface TitleDetail extends Title {
  propBlockId: string
  notes: { id: string; text: string }[]
}

export interface TagInfo {
  title: string
  group?: string
  count: number
}

/** A page whose first block is a title's property block. grim prints every SQL value as a string. */
interface TitleRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  prop_block: string
  prop_text: string
  notes_text: string | null
}

/** A SQL string literal. grim query takes no parameters, so values are quoted here. */
function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

// Pages whose page-level `tags` property (grim derives it from the first top-level block) links to
// the page `media`, with that first block's id and text.
const TITLE_PAGES = `
  with first_blocks as (
    select p.id, p.title, p.created_at, p.updated_at,
      (select b.id from blocks b where b.page_id = p.id and b.parent_id is null
        order by b.order_key limit 1) as prop_block
    from pages p
    where exists (
      select 1 from block_props bp join properties pr on pr.id = bp.property_id
      where bp.owner_kind = 'page' and bp.owner_id = p.id and pr.key = 'tags'
        and bp.value in (select id from pages where title_lower = ${sql(MEDIA_TAG)}))
  )
  select f.id, f.title, f.created_at, f.updated_at, f.prop_block, pb.text as prop_text
  from first_blocks f join blocks pb on pb.id = f.prop_block`

const LIST_TITLES = `
  with t as (${TITLE_PAGES})
  select t.*,
    (select group_concat(text, char(10)) from (
      select b.text from blocks b where b.page_id = t.id and b.id <> t.prop_block
      order by b.order_key)) as notes_text
  from t`

function int(raw?: string): number | undefined {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isNaN(n) ? undefined : n
}

function text(raw?: string): string | undefined {
  return raw ? raw : undefined
}

/** Whether a first block's properties make its page a title: [[media]] in the tags line and a known type. */
function isTitleBlock(props: Map<string, string>): boolean {
  const type = props.get('type')?.toLowerCase() as MediaType | undefined
  return parseTagLine(props.get('tags') ?? '').some((t) => t.toLowerCase() === MEDIA_TAG) && !!type && MEDIA_TYPES.includes(type)
}

/** A Title from a page row, or null when the first block isn't a title's (no [[media]] in its tags line, or no known type). */
function toTitle(row: TitleRow): Title | null {
  const props = parseProps(row.prop_text)
  if (!isTitleBlock(props)) return null
  const tagNames = parseTagLine(props.get('tags') ?? '')
  const type = props.get('type')!.toLowerCase() as MediaType

  const seen = new Set([MEDIA_TAG])
  const tags = tagNames.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
  const { name, year } = splitPageTitle(row.title)
  const genre = props.get('genre')?.split(',').map((g) => g.trim()).filter(Boolean)
  return {
    pageId: row.id,
    pageTitle: row.title,
    name,
    type,
    status: normalizeStatus(props.get('status')),
    tags,
    rating: normalizeRating(props.get('rating')),
    rec: text(props.get('rec')),
    finished: text(props.get('finished')),
    progress: text(props.get('progress')),
    year: int(props.get('year')) ?? year,
    genre: genre?.length ? genre : undefined,
    summary: text(props.get('summary')),
    author: text(props.get('author')),
    appleBooks: text(props.get('apple-books')),
    notesText: row.notes_text ?? '',
    updatedAt: Number(row.updated_at),
    createdAt: Number(row.created_at),
  }
}

/** A page and its first top-level block, read fresh from the graph (block fields null on an empty page). */
interface PageHead {
  id: string
  title: string
  block_id: string | null
  text: string | null
}

async function pageHeads(where: string): Promise<PageHead[]> {
  return (await grim(['query', `
    select p.id, p.title, b.id as block_id, b.text
    from pages p left join blocks b on b.id = (
      select x.id from blocks x where x.page_id = p.id and x.parent_id is null order by x.order_key limit 1)
    where ${where}`])) as PageHead[]
}

/** The page with this title (grim titles are unique ignoring case), if any. */
async function pageNamed(title: string): Promise<PageHead | undefined> {
  return (await pageHeads(`p.title_lower = ${sql(title.toLowerCase())}`))[0]
}

/** A title page's first block, re-read right before a write. Throws for a page that isn't a title. */
async function titleHead(pageId: string): Promise<PageHead & { block_id: string; text: string }> {
  const [head] = await pageHeads(`p.id = ${sql(pageId)}`)
  if (!head || head.block_id === null || head.text === null || !isTitleBlock(parseProps(head.text))) {
    throw new GrimError(`not a title page: ${pageId}`)
  }
  return { ...head, block_id: head.block_id, text: head.text }
}

/** Replace a block's text, unless nothing changed. */
async function editBlock(as: As, blockId: string, before: string, after: string): Promise<void> {
  if (after !== before) await grim(['edit', blockId, after], as)
}

/**
 * Add one block whose text is exactly `text` at the end of a page. grim parses inserted Markdown
 * (a "- " starts a new block, indented "- " a child), so the block is inserted from the first line
 * alone and then set to the exact text.
 */
async function addBlock(as: As, pageTitle: string, text: string): Promise<string> {
  const seed = text.split('\n')[0]!.trim() || '.'
  const { blockIds } = (await grim(['insert', '--page', pageTitle, `- ${seed}`], as)) as { blockIds: string[] }
  const id = blockIds[0]
  if (blockIds.length !== 1 || !id) throw new GrimError(`expected one new block on ${pageTitle}, got ${blockIds.length}`)
  const [row] = (await grim(['query', `select text from blocks where id = ${sql(id)}`])) as { text: string }[]
  await editBlock(as, id, row?.text ?? '', text)
  return id
}

/** A page's top-level blocks in order. */
async function topBlocks(pageId: string): Promise<{ id: string; text: string }[]> {
  return (await grim(['query', `
    select id, text from blocks where page_id = ${sql(pageId)} and parent_id is null order by order_key`])) as
    { id: string; text: string }[]
}

/**
 * Put a property block first on a page whose first block isn't one. A top-level block that `isOurs`
 * (left mid-page by an earlier write that stopped partway) is reused, so a retry never adds a second
 * one; otherwise a new block is added. `build` gives the block's text from its current text ('' for
 * a new block). There is no "insert before", so every block above it is moved, in order, to the
 * end; re-running this after a failed move finishes the job with the prose in its original order.
 */
async function putPropsFirst(
  as: As,
  page: { id: string; title: string },
  isOurs: (props: Map<string, string>) => boolean,
  build: (text: string) => string,
): Promise<void> {
  const stray = (await topBlocks(page.id)).find((b) => isOurs(parseProps(b.text)))
  let id: string
  if (stray) {
    id = stray.id
    await editBlock(as, id, stray.text, build(stray.text))
  } else {
    id = await addBlock(as, page.title, build(''))
  }
  const blocks = await topBlocks(page.id)
  for (const above of blocks.slice(0, blocks.findIndex((b) => b.id === id))) {
    await grim(['move', above.id, '--page', page.title], as)
  }
}

/** The tags line value without its [[media]] / #[[media]] / #media entries; other entries keep their spelling and separators. */
function withoutMedia(value: string): string {
  const media = /#?\[\[\s*media\s*\]\]|#media(?![\w-])/i
  let rest = value
  for (let m = media.exec(rest); m; m = media.exec(rest)) {
    const before = rest.slice(0, m.index).replace(/[\s,]*$/, '')
    const tail = rest.slice(m.index + m[0].length)
    const after = tail.replace(/^[\s,]*/, '')
    const sep = tail.slice(0, tail.length - after.length) || ' '
    rest = before && after ? `${before}${sep}${after}` : before || after
  }
  return rest
}

/** Thrown by createTitle when the page it would write is already a title for a different work. */
/**
 * createTitle won't write to an existing page: `other-type` when the page already has a different `type`
 * (another app's title, a person page, anything typed), `different-work` when it is a title of the same
 * type for another work (different year or ID).
 */
export class TitleConflictError extends Error {
  override name = 'TitleConflictError'
  reason: 'other-type' | 'different-work'
  constructor(message: string, reason: 'other-type' | 'different-work' = 'different-work') {
    super(message)
    this.reason = reason
  }
}

/**
 * Whether a page is already a title for a different work: its apple-books ID or year differs
 * from the incoming one (only where both sides have a value).
 */
function conflictsWith(page: PageHead, type: MediaType, fields: Partial<Record<FieldKey, string>>, year?: number): 'other-type' | 'different-work' | null {
  const props = parseProps(page.text ?? '')
  // Any page that already says it is something else (another app's title, a title removed from the other
  // app, a person page with `type:: person`) is never merged into or retyped, tagged [[media]] or not.
  const otherType = props.get('type')?.trim().toLowerCase()
  if (otherType && otherType !== type) return 'other-type'
  if (!isTitleBlock(props)) return null
  const differs = (have?: string, want?: string) => !!have && !!want && have !== want
  const wantYear = int(fields.year) ?? year
  const haveYear = int(props.get('year'))
  return differs(props.get('apple-books'), fields['apple-books']) || (wantYear !== undefined && haveYear !== undefined && wantYear !== haveYear) ? 'different-work' : null
}

export class Grimoire {
  /** Who grim records as the author of every write: `me` (the owner, the default) or `claude`. */
  private readonly as: As

  constructor(opts: { author?: 'me' | 'claude' } = {}) {
    this.as = { author: opts.author ?? 'me' }
  }

  async listTitles(): Promise<Title[]> {
    const rows = (await grim(['query', LIST_TITLES])) as TitleRow[]
    return rows.flatMap((row) => toTitle(row) ?? [])
  }

  async getTitle(pageId: string): Promise<TitleDetail | null> {
    const [row] = (await grim(['query', `with t as (${TITLE_PAGES}) select * from t where t.id = ${sql(pageId)}`])) as TitleRow[]
    if (!row) return null
    // Every block but the property block, depth first in page order: char(1) sorts below any order-key
    // character, so a block's children come before its next sibling.
    const notes = (await grim(['query', `
      with recursive tree(id, text, path) as (
        select id, text, order_key from blocks where page_id = ${sql(pageId)} and parent_id is null
        union all
        select b.id, b.text, tree.path || char(1) || b.order_key from blocks b join tree on b.parent_id = tree.id)
      select id, text from tree where id <> ${sql(row.prop_block)} order by path`])) as { id: string; text: string }[]
    const title = toTitle({ ...row, notes_text: notes.map((n) => n.text).join('\n') })
    return title && { ...title, propBlockId: row.prop_block, notes }
  }

  /** Tags linked from any title's tags line, plus every page with a `group::` line, without media. */
  async listTags(): Promise<TagInfo[]> {
    const counts = new Map<string, { spelling: string; count: number }>()
    for (const title of await this.listTitles()) {
      for (const tag of title.tags) {
        const entry = counts.get(tag.toLowerCase()) ?? { spelling: tag, count: 0 }
        entry.count++
        counts.set(tag.toLowerCase(), entry)
      }
    }
    const pages = (await grim(['query', `
      select p.title_lower, p.title,
        (select b.text from blocks b where b.page_id = p.id and b.parent_id is null
          order by b.order_key limit 1) as first_text
      from pages p
      where p.title_lower in (select value from json_each(${sql(JSON.stringify([...counts.keys()]))}))
        or exists (
          select 1 from block_props bp join properties pr on pr.id = bp.property_id
          where bp.owner_kind = 'page' and bp.owner_id = p.id and pr.key = 'group')`])) as
      { title_lower: string; title: string; first_text: string | null }[]

    const tags = new Map<string, TagInfo>()
    for (const [key, { spelling, count }] of counts) tags.set(key, { title: spelling, count })
    for (const page of pages) {
      if (page.title_lower === MEDIA_TAG) continue
      const group = text(parseProps(page.first_text ?? '').get('group'))
      tags.set(page.title_lower, {
        title: page.title,
        ...(group ? { group } : {}),
        count: counts.get(page.title_lower)?.count ?? 0,
      })
    }
    return [...tags.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  /** The title as read back after a write. */
  private async reread(pageId: string): Promise<Title> {
    const detail = await this.getTitle(pageId)
    if (!detail) throw new GrimError(`not a title page after writing: ${pageId}`)
    const { propBlockId: _block, notes: _notes, ...title } = detail
    return title
  }

  /** Set (or with null remove) property lines in a title's first block; every other line is kept as is. */
  async setFields(pageId: string, fields: Partial<Record<FieldKey, string | null>>, opts: SetFieldsOptions = {}): Promise<Title> {
    // Without a known type the page would silently drop out of Stacks.
    if ('type' in fields && fields.type !== undefined && !MEDIA_TYPES.includes(fields.type as MediaType)) {
      throw new Error(`unknown type: ${String(fields.type)}`)
    }
    return serially(async () => {
      const head = await titleHead(pageId)
      // Background writes decide from an older read; this check, inside the queue, keeps a status
      // the owner changed in the meantime (say, to dropped) from being overwritten.
      if (opts.onlyIfStatus && !opts.onlyIfStatus.includes(normalizeStatus(parseProps(head.text).get('status')))) {
        return this.reread(pageId)
      }
      let next = head.text
      for (const [key, value] of Object.entries(fields) as [FieldKey, string | null | undefined][]) {
        if (value !== undefined) next = setProp(next, key, value)
      }
      await editBlock(this.as, head.block_id, head.text, next)
      return this.reread(pageId)
    })
  }

  /** Rewrite the tags line as [[media]] followed by these tags. */
  async setTags(pageId: string, tags: string[]): Promise<Title> {
    return serially(async () => {
      const head = await titleHead(pageId)
      await editBlock(this.as, head.block_id, head.text, setProp(head.text, 'tags', tagLine(tags)))
      return this.reread(pageId)
    })
  }

  /** Take [[media]] out of the tags line (and the line itself if nothing else is left). The page and its notes stay. */
  async removeFromStacks(pageId: string): Promise<void> {
    return serially(async () => {
      const head = await titleHead(pageId)
      const rest = withoutMedia(parseProps(head.text).get('tags') ?? '')
      await editBlock(this.as, head.block_id, head.text, setProp(head.text, 'tags', rest || null))
    })
  }

  /** Add a note block at the end of a title page, with the text exactly as given. */
  async addNote(pageId: string, text: string): Promise<{ id: string }> {
    if (!text.trim()) throw new Error('a note needs some text')
    return serially(async () => {
      const head = await titleHead(pageId)
      return { id: await addBlock(this.as, head.title, text) }
    })
  }

  /** Replace a note's text. Refuses a block that isn't a note on a title page. */
  async editNote(blockId: string, text: string): Promise<void> {
    return serially(async () => {
      const [block] = (await grim(['query', `select page_id from blocks where id = ${sql(blockId)}`])) as { page_id: string }[]
      if (!block) throw new NotFoundError(`block not found: ${blockId}`)
      const head = await titleHead(block.page_id)
      if (head.block_id === blockId) throw new NotANoteError(`not a note: ${blockId} is the property block`)
      await grim(['edit', blockId, text], this.as)
    })
  }

  /**
   * Make a page a title. Uses the page `Name (Year)` (or `Name`) if it exists: merges into its first
   * block when that block has properties, else adds a property block before everything else.
   * Otherwise creates the page.
   */
  async createTitle(input: {
    name: string
    year?: number
    type: MediaType
    fields: Partial<Record<FieldKey, string>>
    tags: string[]
  }): Promise<Title> {
    const name = input.name.trim()
    if (!name) throw new Error('a title needs a name')
    if (!MEDIA_TYPES.includes(input.type)) throw new Error(`unknown type: ${input.type}`)
    const pageTitle = input.year ? `${name} (${input.year})` : name
    return serially(async () => {
      // A yearless page with the bare name is the same work (e.g. prose notes on "The White Lotus" before
      // adding "The White Lotus (2021)"), unless it is already a title with a different apple-books ID or year.
      // The exact page can't be skipped (page names are unique), so a conflict there is an error.
      let page = await pageNamed(pageTitle)
      let addYear = false
      const pageConflict = page ? conflictsWith(page, input.type, input.fields, input.year) : null
      if (page && pageConflict) {
        throw new TitleConflictError(`${page.title} is already ${pageConflict === 'other-type' ? 'something other than a ' + input.type : 'a title for a different work'}`, pageConflict)
      }
      if (!page && input.year) {
        const bare = await pageNamed(name)
        if (bare && conflictsWith(bare, input.type, input.fields, input.year) === null) {
          page = bare
          addYear = true
        }
      }

      // Existing tags are kept, [[media]] first; then type (and year on a yearless page) and the given fields.
      const merge = (text: string) => {
        let next = setProp(text, 'tags', tagLine([...parseTagLine(parseProps(text).get('tags') ?? ''), ...input.tags]))
        next = setProp(next, 'type', input.type)
        if (addYear && !parseProps(text).has('year')) next = setProp(next, 'year', String(input.year))
        for (const [key, value] of Object.entries(input.fields) as [FieldKey, string | undefined][]) {
          if (key !== 'type' && value !== undefined && value.trim() !== '') next = setProp(next, key, value)
        }
        return next
      }

      if (!page) {
        const created = (await grim(['create-page', pageTitle], this.as)) as { id: string }
        await addBlock(this.as, pageTitle, merge(''))
        return this.reread(created.id)
      }
      if (page.block_id !== null && page.text !== null && parseProps(page.text).size > 0) {
        await editBlock(this.as, page.block_id, page.text, merge(page.text))
      } else {
        await putPropsFirst(this.as, page, isTitleBlock, merge)
      }
      return this.reread(page.id)
    })
  }

  /** Whether a page with this name exists (any case), and if so whether it is already a title page of this app. Reads only. */
  async pageKind(name: string): Promise<'none' | 'book' | 'other'> {
    const page = await pageNamed(name)
    if (!page) return 'none'
    return page.text !== null && isTitleBlock(parseProps(page.text)) ? 'book' : 'other'
  }

  /** Set (or with null remove) the `group::` line on a tag's page, creating the page if needed. */
  async setTagGroup(tag: string, group: string | null): Promise<void> {
    return serially(async () => {
      const page = await pageNamed(tag)
      if (page && page.block_id !== null && page.text !== null && parseProps(page.text).size > 0) {
        const next = setProp(page.text, 'group', group)
        // A block left empty is deleted, but never one with children (grim deletes those with it).
        const [kids] = (await grim(['query', `select count(*) as n from blocks where parent_id = ${sql(page.block_id)}`])) as { n: string }[]
        if (next.trim() === '' && kids?.n === '0') await grim(['delete', page.block_id], this.as)
        else await editBlock(this.as, page.block_id, page.text, next)
        return
      }
      if (group === null) return
      const target = page ?? { id: ((await grim(['create-page', tag], this.as)) as { id: string }).id, title: tag }
      await putPropsFirst(this.as, target, (props) => props.has('group'), (text) => setProp(text, 'group', group))
    })
  }

  /** Move every tag in group `from` to group `to`. */
  async renameGroup(from: string, to: string): Promise<void> {
    return serially(async () => {
      const candidates = await pageHeads(`exists (
        select 1 from block_props bp join properties pr on pr.id = bp.property_id
        where bp.owner_kind = 'page' and bp.owner_id = p.id and pr.key = 'group')`)
      for (const candidate of candidates) {
        // Re-read each page right before changing it.
        const [head] = await pageHeads(`p.id = ${sql(candidate.id)}`)
        if (!head?.block_id || head.text === null || parseProps(head.text).get('group') !== from) continue
        await editBlock(this.as, head.block_id, head.text, setProp(head.text, 'group', to))
      }
    })
  }
}
