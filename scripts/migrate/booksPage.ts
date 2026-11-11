// Reads an old Grimoire `books` list page into planned book pages.
//
// Shape of that page: top-level sections (Reading, To Read, Finished Reading, Did Not Finish, a topics
// section, and "## From <person> …" sections) hold genre headings, which hold books. A book either has a
// child block of `key:: value` lines (author, genre, rating, year, notes) plus optional note children such
// as "[[Alice]] recommended this", or is a single block "TODO Title\nauthor:: …".

import type { FieldKey, Status } from '../../src/shared/title.ts'
import { normalizeRating, parseProps } from '../../src/shared/titleFormat.ts'
import type { PlannedBook } from '../lib/planned.ts'

export interface Block { text: string; children?: Block[] }
export interface SkippedLine { text: string; reason: string }

const SECTION_STATUS: Record<string, Status> = {
  reading: 'doing',
  'to read': 'want',
  'finished reading': 'done',
  'did not finish': 'dropped',
}
const MARKER = /^(TODO|DOING|DONE)\s+/
const MARKER_STATUS: Record<string, Status> = { TODO: 'want', DOING: 'doing', DONE: 'done' }
const PROP = /^\s*[A-Za-z][\w-]*\s*::/
const RECOMMENDED = /^(?:\[\[([^\]]+)\]\]|(.+?)) recommended this$/i

const isPropBlock = (b: Block) => b.text.split('\n').every((l) => l.trim() === '' || PROP.test(l))
const hasPropLines = (text: string) => text.split('\n').some((l) => PROP.test(l))

/** A block is a book if it carries properties (its own or a property child), or has no children at all. */
function isBook(b: Block): boolean {
  const kids = b.children ?? []
  return hasPropLines(b.text) || kids.some(isPropBlock) || kids.length === 0
}

function toBook(b: Block, sectionStatus: Status | undefined, sectionRec: string | undefined, path: string[]): PlannedBook {
  const [first = '', ...rest] = b.text.split('\n')
  const marker = MARKER.exec(first)?.[1]
  const name = first.replace(MARKER, '').trim()
  const props = parseProps([...rest, ...(b.children ?? []).filter(isPropBlock).map((c) => c.text)].join('\n'))
  const notes: string[] = []
  let rec = props.get('rec') || sectionRec
  for (const child of (b.children ?? []).filter((c) => !isPropBlock(c))) {
    const m = RECOMMENDED.exec(child.text.trim())
    if (m) rec = (m[1] ?? m[2])!.trim()
    else notes.push(child.text.trim())
  }
  if (props.get('notes')) notes.unshift(props.get('notes')!)

  const fields: Partial<Record<FieldKey, string>> = {}
  const status = (marker ? MARKER_STATUS[marker] : undefined) ?? sectionStatus ?? 'want'
  fields.status = status
  for (const key of ['author', 'genre', 'year'] as const) if (props.get(key)) fields[key] = props.get(key)!
  const rating = normalizeRating(props.get('rating'))
  if (rating !== undefined) fields.rating = String(rating)
  if (rec) fields.rec = rec
  const year = /^\d{4}$/.test(fields.year ?? '') ? fields.year : undefined
  if (!year) delete fields.year

  return { pageTitle: year ? `${name} (${year})` : name, fields, tags: [], notes, sources: [`books › ${path.join(' › ')}`] }
}

/** Every book on the page, once each (first occurrence wins), plus lines that were deliberately skipped. */
export function parseBooksPage(blocks: Block[]): { books: PlannedBook[]; skipped: SkippedLine[] } {
  const books: PlannedBook[] = []
  const skipped: SkippedLine[] = []
  const seen = new Set<string>()

  const visit = (b: Block, status: Status | undefined, rec: string | undefined, path: string[]) => {
    if (isBook(b)) {
      const book = toBook(b, status, rec, path)
      const key = book.pageTitle.toLowerCase()
      if (!book.pageTitle) skipped.push({ text: b.text, reason: 'empty title' })
      else if (seen.has(key)) skipped.push({ text: b.text, reason: 'duplicate' })
      else { seen.add(key); books.push(book) }
      return
    }
    for (const c of b.children ?? []) visit(c, status, rec, [...path, b.text.trim()])
  }

  for (const top of blocks) {
    const heading = top.text.trim()
    const key = heading.toLowerCase()
    if (isPropBlock(top)) continue // the page's own `tags:: [[list]]`
    if (key.startsWith('topics to explore')) {
      for (const c of top.children ?? []) skipped.push({ text: c.text, reason: 'topic with no book chosen yet' })
      continue
    }
    const from = /^#+\s*from\s+(.+?)\s*\(/i.exec(heading)?.[1]
    const status = SECTION_STATUS[key]
    if (status === undefined && from === undefined) {
      skipped.push({ text: heading, reason: 'unknown section' })
      continue
    }
    for (const c of top.children ?? []) visit(c, status, from, [heading])
  }
  return { books, skipped }
}
