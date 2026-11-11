// Writes small, valid EPUB 3 folders (the unpacked form Apple Books keeps in iCloud) for tests.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A 1×1 PNG. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export interface EpubOptions {
  title?: string
  author?: string
  isbn?: string
  language?: string
  cover?: boolean
  coverStyle?: 'properties' | 'meta'
  chapters?: number
}

export function makeEpubFolder(dir: string, opts: EpubOptions = {}): string {
  const { coverStyle = 'properties', chapters = 2 } = opts
  mkdirSync(join(dir, 'META-INF'), { recursive: true })
  mkdirSync(join(dir, 'OEBPS'), { recursive: true })
  writeFileSync(join(dir, 'mimetype'), 'application/epub+zip')
  writeFileSync(join(dir, 'META-INF', 'container.xml'),
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
    `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
  const items: string[] = []
  const spine: string[] = []
  for (let i = 1; i <= chapters; i++) {
    writeFileSync(join(dir, 'OEBPS', `ch${i}.xhtml`),
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${i}</title></head>` +
      `<body><h1>Chapter ${i}</h1><p>Text of chapter ${i}.</p></body></html>`)
    items.push(`<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="ch${i}"/>`)
  }
  let coverMeta = ''
  if (opts.cover) {
    writeFileSync(join(dir, 'OEBPS', 'cover.png'), PNG_1PX)
    if (coverStyle === 'properties') items.push(`<item id="img1" href="cover.png" media-type="image/png" properties="cover-image"/>`)
    else {
      items.push(`<item id="img1" href="cover.png" media-type="image/png"/>`)
      coverMeta = `<meta name="cover" content="img1"/>`
    }
  }
  const md = [
    opts.title ? `<dc:title>${opts.title}</dc:title>` : '',
    opts.author ? `<dc:creator>${opts.author}</dc:creator>` : '',
    opts.isbn ? `<dc:identifier opf:scheme="ISBN">${opts.isbn}</dc:identifier>` : `<dc:identifier id="uid">urn:uuid:1234</dc:identifier>`,
    `<dc:language>${opts.language ?? 'en'}</dc:language>`,
    coverMeta,
  ].join('')
  writeFileSync(join(dir, 'OEBPS', 'content.opf'),
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${md}</metadata>` +
    `<manifest>${items.join('')}</manifest><spine>${spine.join('')}</spine></package>`)
  writeFileSync(join(dir, '.DS_Store'), 'junk')
  writeFileSync(join(dir, 'iTunesMetadata.plist'), '<plist/>')
  return dir
}

/** A minimal PDF with one blank page. */
export function minimalPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  )
}
