// Reading and editing the `key:: value` lines of a title page's first block.
// Edits change exactly one line and leave every other byte alone, because
// The owner also edits these blocks by hand in Grimoire.

import { MEDIA_TAG, type FieldKey, type Status } from './title.ts'

// indent, key, value, and a trailing \r kept so Windows line endings survive an edit.
const PROP_LINE = /^(\s*)([A-Za-z][\w-]*)\s*::(.*?)(\r?)$/

/** Property lines of a block, keys lowercased, values trimmed; a repeated key keeps its last value. */
export function parseProps(text: string): Map<string, string> {
  const props = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = PROP_LINE.exec(line)
    if (m) props.set(m[2]!.toLowerCase(), m[3]!.trim())
  }
  return props
}

/**
 * Set, add or (with null) remove one property line. The first line whose key matches
 * case-insensitively is replaced (its key rewritten lowercase, its indent and line ending kept);
 * a missing key is appended. Newlines inside a value become spaces, so a value is always one line.
 * Removing a property removes only its own line.
 */
export function setProp(text: string, key: FieldKey | 'tags' | 'group', value: string | null): string {
  const clean = value === null ? null : value.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  const lines = text === '' ? [] : text.split('\n')
  const i = lines.findIndex((line) => PROP_LINE.exec(line)?.[2]!.toLowerCase() === key)
  if (i === -1) {
    if (clean === null) return text
    if (text === '') return `${key}:: ${clean}`
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    return `${text}${text.endsWith('\n') ? '' : eol}${key}:: ${clean}`
  }
  if (clean === null) {
    const wasLast = i === lines.length - 1
    lines.splice(i, 1)
    if (wasLast && lines.length > 0) lines[lines.length - 1] = lines[lines.length - 1]!.replace(/\r$/, '')
  } else {
    const m = PROP_LINE.exec(lines[i]!)!
    lines[i] = `${m[1]}${key}:: ${clean}${m[4]}`
  }
  return lines.join('\n')
}

const STATUS_WORDS: Record<string, Status> = {
  want: 'want', todo: 'want', 'to-play': 'want', installed: 'want', 'to read': 'want', 'to-read': 'want',
  doing: 'doing', reading: 'doing', playing: 'doing', watching: 'doing',
  done: 'done', played: 'done', watched: 'done', read: 'done', finished: 'done',
  dropped: 'dropped',
}

/** Map current and legacy status words to a Status; anything unknown is 'want'. */
export function normalizeStatus(raw?: string): Status {
  return STATUS_WORDS[(raw ?? '').trim().toLowerCase()] ?? 'want'
}

/** "5", "5/5" and "4.0" become whole numbers 1 to 5; anything else (TBD, 4.5, 6) is undefined. */
export function normalizeRating(raw?: string): number | undefined {
  const m = /^(\d+)(?:\.0+)?(?:\/5)?$/.exec((raw ?? '').trim())
  if (!m) return undefined
  const n = Number(m[1])
  return n >= 1 && n <= 5 ? n : undefined
}

/** The tags line value: [[media]] first, then the given tags once each (case-insensitive, first spelling kept). */
export function tagLine(tags: string[]): string {
  const seen = new Set([MEDIA_TAG])
  const rest: string[] = []
  for (const t of tags) {
    const k = t.toLowerCase()
    if (!seen.has(k)) { seen.add(k); rest.push(t) }
  }
  return [MEDIA_TAG, ...rest].map((t) => `[[${t}]]`).join(', ')
}

/** Tag page titles from a tags line value: "[[media]], #Anime, #[[Slow Burn]]". */
export function parseTagLine(value: string): string[] {
  return [...value.matchAll(/\[\[([^\]]+)\]\]|#([\w-]+)/g)].map((m) => (m[1] ?? m[2])!.trim())
}

/** "Dune (2021)" → { name: "Dune", year: 2021 }; a title without a trailing four-digit year keeps its whole name. */
export function splitPageTitle(pageTitle: string): { name: string; year?: number } {
  const m = /^(.*\S) \((\d{4})\)$/.exec(pageTitle)
  return m ? { name: m[1]!, year: Number(m[2]) } : { name: pageTitle }
}
