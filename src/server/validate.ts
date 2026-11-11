// Every request body the API accepts is checked here, in one place.

import { COLORS, type Annotation, type Position, type Session, type SyncRequest } from '../shared/api.ts'
import { MEDIA_TAG, STATUSES } from '../shared/title.ts'
import type { EditableFields } from '../library/editor.ts'

export class BadRequest extends Error {
  override name = 'BadRequest'
}

const MAX_RECORDS = 5_000
const MAX_LOCATOR_BYTES = 16 * 1024
const MAX_TEXT = 20_000

type Obj = Record<string, unknown>

function obj(v: unknown, what: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BadRequest(`${what} must be an object`)
  return v as Obj
}

function str(o: Obj, key: string, max = 200): string {
  const v = o[key]
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest(`${key} must be a non-empty string`)
  if (v.length > max) throw new BadRequest(`${key} is longer than ${max} characters`)
  return v
}

function num(o: Obj, key: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new BadRequest(`${key} must be a number from ${min} to ${max}`)
  return v
}

function int(o: Obj, key: string): number {
  const v = num(o, key)
  if (!Number.isInteger(v)) throw new BadRequest(`${key} must be a whole number`)
  return v
}

function locator(o: Obj): Obj {
  const l = obj(o.locator, 'locator')
  if (Buffer.byteLength(JSON.stringify(l)) > MAX_LOCATOR_BYTES) throw new BadRequest('locator is larger than 16 KB')
  return l
}

function records<T>(v: unknown, key: string, parse: (o: Obj) => T): T[] {
  if (!Array.isArray(v)) throw new BadRequest(`${key} must be a list`)
  if (v.length > MAX_RECORDS) throw new BadRequest(`${key} has more than ${MAX_RECORDS} records`)
  return v.map((r) => parse(obj(r, key)))
}

function position(o: Obj): Position {
  return { bookId: str(o, 'bookId'), device: str(o, 'device'), locator: locator(o), progression: num(o, 'progression', 0, 1), updatedAt: int(o, 'updatedAt') }
}

function session(o: Obj): Session {
  return {
    sessionId: str(o, 'sessionId'), bookId: str(o, 'bookId'), device: str(o, 'device'),
    startedAt: int(o, 'startedAt'), endedAt: int(o, 'endedAt'), activeSeconds: int(o, 'activeSeconds'),
    startProgression: num(o, 'startProgression', 0, 1), endProgression: num(o, 'endProgression', 0, 1), pagesTurned: int(o, 'pagesTurned'),
  }
}

function annotation(o: Obj): Annotation {
  if (o.kind !== 'highlight' && o.kind !== 'note') throw new BadRequest('kind must be highlight or note')
  if (!COLORS.includes(o.color as never)) throw new BadRequest(`color must be one of ${COLORS.join(', ')}`)
  if (o.source !== 'stacks' && o.source !== 'apple-books') throw new BadRequest('source must be stacks or apple-books')
  if (typeof o.text !== 'string' || o.text.length > MAX_TEXT) throw new BadRequest(`text must be a string of at most ${MAX_TEXT} characters`)
  if (o.note !== null && (typeof o.note !== 'string' || o.note.length > MAX_TEXT)) throw new BadRequest(`note must be null or at most ${MAX_TEXT} characters`)
  return {
    annotationId: str(o, 'annotationId'), bookId: str(o, 'bookId'), kind: o.kind, color: o.color as Annotation['color'],
    locator: locator(o), text: o.text, note: o.note as string | null, createdAt: int(o, 'createdAt'), updatedAt: int(o, 'updatedAt'),
    deletedAt: o.deletedAt === null ? null : int(o, 'deletedAt'), device: str(o, 'device'), source: o.source,
  }
}

function closing(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest('closing must be a book id')
  return v
}

export function parseSyncRequest(body: unknown): SyncRequest {
  const o = obj(body, 'the request')
  return {
    device: str(o, 'device', 64),
    since: int(o, 'since'),
    positions: records(o.positions, 'positions', position),
    sessions: records(o.sessions, 'sessions', session),
    annotations: records(o.annotations, 'annotations', annotation),
    ...(closing(o.closing) ? { closing: closing(o.closing) } : {}),
  }
}

/** YYYY-MM-DD that is a real date. */
function isDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === v
}

/** A tag that can sit inside [[...]] on one line, and isn't media itself (same rules as Hoard). */
function tagName(tag: unknown): string {
  if (typeof tag !== 'string' || !tag.trim()) throw new BadRequest('a tag must be a non-empty string')
  if (/\[\[|\]\]|[\r\n]/.test(tag)) throw new BadRequest(`a tag can't contain [[, ]] or a line break: ${JSON.stringify(tag)}`)
  if (tag.trim().toLowerCase() === MEDIA_TAG) throw new BadRequest(`${MEDIA_TAG} is not a tag you can set`)
  return tag
}

export function parseBookPatch(body: unknown): { fields: Omit<EditableFields, 'progress'>; tags?: string[] } {
  const o = obj(body, 'the request')
  const fields: Omit<EditableFields, 'progress'> = {}
  let tags: string[] | undefined
  for (const [key, v] of Object.entries(o)) {
    switch (key) {
      case 'status':
        if (!STATUSES.includes(v as never)) throw new BadRequest(`status must be one of ${STATUSES.join(', ')}`)
        fields.status = v as string
        break
      case 'rating':
        if (v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5)) throw new BadRequest('rating must be a whole number from 1 to 5, or null')
        fields.rating = v === null ? null : String(v)
        break
      case 'rec':
        if (v !== null && (typeof v !== 'string' || !v.trim() || /[\r\n]/.test(v))) throw new BadRequest('rec must be a one-line name, or null')
        fields.rec = v as string | null
        break
      case 'finished':
        if (v !== null && (typeof v !== 'string' || !isDate(v))) throw new BadRequest('finished must be a YYYY-MM-DD date, or null')
        fields.finished = v as string | null
        break
      case 'tags':
        if (!Array.isArray(v)) throw new BadRequest('tags must be a list of strings')
        tags = v.map(tagName)
        break
      default:
        throw new BadRequest(`${key} can't be changed here`)
    }
  }
  return tags ? { fields, tags } : { fields }
}
