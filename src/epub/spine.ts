// An EPUB's reading order: the spine's documents, as paths from the archive root (Readium's hrefs).

import { posix } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { readZipEntry } from './zip.ts'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  isArray: (name) => ['item', 'itemref', 'rootfile'].includes(name),
})

type Node = Record<string, unknown>
const list = (n: unknown): Node[] => (Array.isArray(n) ? (n as Node[]) : [])

/** Spine document paths in reading order; [] when the EPUB can't be read. */
export function readSpine(bytes: Uint8Array): string[] {
  try {
    const container = readZipEntry(bytes, 'META-INF/container.xml')
    if (!container) return []
    const root = (parser.parse(Buffer.from(container).toString('utf8')) as Node).container as Node | undefined
    const opfPath = list((root?.rootfiles as Node | undefined)?.rootfile)[0]?.['@full-path']
    if (typeof opfPath !== 'string') return []
    const opf = readZipEntry(bytes, opfPath)
    if (!opf) return []
    const pkg = (parser.parse(Buffer.from(opf).toString('utf8')) as Node).package as Node | undefined
    const hrefs = new Map(list((pkg?.manifest as Node | undefined)?.item).map((i) => [String(i['@id']), String(i['@href'])]))
    return list((pkg?.spine as Node | undefined)?.itemref).flatMap((ref) => {
      const href = hrefs.get(String(ref['@idref']))
      return href ? [posix.join(posix.dirname(opfPath), decodeURIComponent(href))] : []
    })
  } catch {
    return []
  }
}
