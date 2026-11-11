import type { FieldKey, MediaType } from '../shared/title.ts'
import type { Lookup, LookupResult } from './ports.ts'
import { getJson, LOOKUP_TIMEOUT_MS, LookupUnavailableError } from './lookupError.ts'
import type { FetchLike } from './lookupError.ts'

export interface OpenLibraryOptions {
  fetch?: FetchLike
}

const BASE = 'https://openlibrary.org'

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'mt', 'e.g', 'i.e', 'etc'])

/** True when the "." at `dot` ends an abbreviation or a single-capital initial, not a sentence. */
function isAbbreviation(text: string, dot: number): boolean {
  const word = /([\p{L}.]+)$/u.exec(text.slice(0, dot))?.[1] ?? ''
  if (/^\p{Lu}$/u.test(word)) return true
  return ABBREVIATIONS.has(word.toLowerCase())
}

/** First sentence of a work description; drops a trailing "([source][1])" note. Doesn't cut at "Mr." or "J. R. R.". */
export function firstSentence(raw: string): string {
  const text = raw.replace(/\s*\(\[[^\]]*\]\[\d+\]\)/g, '').replace(/\r?\n+/g, ' ').trim()
  const re = /[.!?](?=\s|$)/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === '.' && isAbbreviation(text, m.index)) continue
    return text.slice(0, m.index + 1).trim()
  }
  return text
}

/** Open Library client for books. `detail` of a search result is the first author. */
export class OpenLibraryClient implements Lookup {
  private fetchFn: FetchLike

  constructor(opts: OpenLibraryOptions = {}) {
    this.fetchFn = opts.fetch ?? ((url) => fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }))
  }

  async search(_type: MediaType, q: string): Promise<LookupResult[]> {
    return this.searchQuery(`title=${encodeURIComponent(q)}`)
  }

  private async searchQuery(query: string): Promise<LookupResult[]> {
    const data = obj(await this.get(`/search.json?${query}&limit=10`))
    const docs = Array.isArray(data?.docs) ? (data.docs as unknown[]) : []
    const out: LookupResult[] = []
    for (const raw of docs) {
      const d = obj(raw)
      const key = typeof d?.key === 'string' ? /^\/works\/(.+)$/.exec(d.key)?.[1] : undefined
      if (!d || !key || typeof d.title !== 'string') continue
      const authors = Array.isArray(d.author_name) ? d.author_name : []
      out.push({
        source: 'openlibrary',
        id: key,
        name: d.title,
        year: typeof d.first_publish_year === 'number' ? d.first_publish_year : undefined,
        detail: typeof authors[0] === 'string' ? authors[0] : '',
      })
    }
    return out
  }

  async details(_type: MediaType, id: string): Promise<Partial<Record<FieldKey, string>>> {
    return (await this.work(id)).fields
  }

  /** The edition with this ISBN and its work, or null when Open Library doesn't know it. */
  async byIsbn(isbn: string): Promise<{ workId: string; editionId: string; coverId?: number; pageCount?: number; publisher?: string } | null> {
    const ed = obj(await this.get(`/isbn/${encodeURIComponent(isbn)}.json`))
    const editionId = typeof ed?.key === 'string' ? /^\/books\/(.+)$/.exec(ed.key)?.[1] : undefined
    const workKey = obj((Array.isArray(ed?.works) ? ed.works : [])[0])?.key
    const workId = typeof workKey === 'string' ? /^\/works\/(.+)$/.exec(workKey)?.[1] : undefined
    if (!ed || !editionId || !workId) return null
    const out: { workId: string; editionId: string; coverId?: number; pageCount?: number; publisher?: string } = { workId, editionId }
    const cover = (Array.isArray(ed.covers) ? ed.covers : [])[0]
    if (typeof cover === 'number' && cover > 0) out.coverId = cover
    if (typeof ed.number_of_pages === 'number') out.pageCount = ed.number_of_pages
    const publisher = (Array.isArray(ed.publishers) ? ed.publishers : [])[0]
    if (typeof publisher === 'string' && publisher) out.publisher = publisher
    return out
  }

  /** Search by title, and author when known. */
  async searchBook(title: string, author?: string): Promise<LookupResult[]> {
    const q = `title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}`
    return this.searchQuery(q)
  }

  /** A work's author, year and one-sentence summary, plus its subjects (for the genre). */
  async work(id: string): Promise<{ fields: Partial<Record<FieldKey, string>>; subjects: string[] }> {
    const work = obj(await this.get(`/works/${encodeURIComponent(id)}.json`))
    if (!work) return { fields: {}, subjects: [] }
    const subjects = (Array.isArray(work.subjects) ? work.subjects : []).filter((s): s is string => typeof s === 'string')
    const out: Partial<Record<FieldKey, string>> = {}

    const authorKey = obj(obj((Array.isArray(work.authors) ? work.authors : [])[0])?.author)?.key
    if (typeof authorKey === 'string') {
      const name = obj(await this.get(`${authorKey}.json`))?.name
      if (typeof name === 'string' && name) out.author = name
    }

    const year = typeof work.first_publish_date === 'string' ? /\d{4}/.exec(work.first_publish_date)?.[0] : undefined
    if (year) out.year = year

    const desc = typeof work.description === 'string' ? work.description : obj(work.description)?.value
    if (typeof desc === 'string') {
      const s = firstSentence(desc)
      if (s) out.summary = s
    }
    return { fields: out, subjects }
  }

  private async get(path: string): Promise<unknown> {
    const { ok, status, body } = await getJson(this.fetchFn, `${BASE}${path}`, 'Open Library')
    if (status === 404) return null
    if (!ok) throw new LookupUnavailableError(`Open Library returned HTTP ${status}`)
    if (body === null) throw new LookupUnavailableError('Open Library returned a non-JSON body')
    return body
  }
}
