// What an EPUB says about itself, from its OPF package file: title, authors, ISBN, language, publisher, cover.

import { posix } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { toIsbn13 } from './isbn.ts'
import { readZipEntry } from './zip.ts'

export interface EpubMetadata {
  title?: string
  authors: string[]
  isbn?: string
  language?: string
  publisher?: string
  cover?: { bytes: Uint8Array; mediaType: string }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  textNodeName: '#text',
  isArray: (name) => ['item', 'identifier', 'creator', 'meta', 'title', 'rootfile', 'language', 'publisher'].includes(name),
})

type Node = Record<string, unknown>

function text(n: unknown): string | undefined {
  const v = typeof n === 'object' && n !== null ? (n as Node)['#text'] : n
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return s || undefined
}

function list(n: unknown): Node[] {
  return Array.isArray(n) ? (n as Node[]) : []
}

/** Never throws: a broken or bare EPUB gives `{ authors: [] }`. */
export function readEpubMetadata(bytes: Uint8Array): EpubMetadata {
  try {
    return read(bytes)
  } catch {
    return { authors: [] }
  }
}

function read(bytes: Uint8Array): EpubMetadata {
  const container = readZipEntry(bytes, 'META-INF/container.xml')
  if (!container) return { authors: [] }
  const root = (parser.parse(Buffer.from(container).toString('utf8')) as Node).container as Node | undefined
  const opfPath = list((root?.rootfiles as Node | undefined)?.rootfile)[0]?.['@full-path']
  if (typeof opfPath !== 'string') return { authors: [] }
  const opfBytes = readZipEntry(bytes, opfPath)
  if (!opfBytes) return { authors: [] }
  const pkg = (parser.parse(Buffer.from(opfBytes).toString('utf8')) as Node).package as Node | undefined
  const md = pkg?.metadata as Node | undefined
  if (!md) return { authors: [] }

  const out: EpubMetadata = { authors: list(md.creator).map(text).filter((s): s is string => !!s) }
  const title = text(list(md.title)[0])
  if (title) out.title = title
  for (const id of list(md.identifier)) {
    const isbn = toIsbn13(text(id) ?? '')
    if (isbn) {
      out.isbn = isbn
      break
    }
  }
  const language = text(list(md.language)[0])
  if (language) out.language = language
  const publisher = text(list(md.publisher)[0])
  if (publisher) out.publisher = publisher

  const items = list((pkg?.manifest as Node | undefined)?.item)
  const metaCoverId = list(md.meta).find((m) => m['@name'] === 'cover')?.['@content']
  const coverItem =
    items.find((i) => String(i['@properties'] ?? '').split(/\s+/).includes('cover-image')) ??
    items.find((i) => typeof metaCoverId === 'string' && i['@id'] === metaCoverId) ??
    items.find((i) => String(i['@media-type'] ?? '').startsWith('image/') && /cover/i.test(`${i['@id']} ${i['@href']}`))
  if (coverItem && typeof coverItem['@href'] === 'string') {
    const href = posix.join(posix.dirname(opfPath), decodeURIComponent(coverItem['@href']))
    const coverBytes = readZipEntry(bytes, href)
    if (coverBytes) out.cover = { bytes: coverBytes, mediaType: String(coverItem['@media-type'] ?? 'image/jpeg') }
  }
  return out
}
