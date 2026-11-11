import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { makeEpubFolder, PNG_1PX } from '../../test/fixtures/makeEpub.ts'
import { toIsbn13 } from './isbn.ts'
import { readEpubMetadata } from './metadata.ts'
import { readZipEntry, zipEpubFolder } from './zip.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'stacks-epub-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('zipEpubFolder', () => {
  test('mimetype is the first entry and stored uncompressed', () => {
    const bytes = zipEpubFolder(makeEpubFolder(join(dir, 'b.epub')))
    // Local file header: name at offset 30, compression method (0 = stored) at offset 8.
    expect(Buffer.from(bytes.subarray(30, 38)).toString()).toBe('mimetype')
    expect(bytes[8]).toBe(0)
    expect(Buffer.from(bytes.subarray(38, 58)).toString()).toBe('application/epub+zip')
  })

  test('round-trips every file', () => {
    const bytes = zipEpubFolder(makeEpubFolder(join(dir, 'b.epub'), { cover: true }))
    const names = Object.keys(unzipSync(bytes)).sort()
    expect(names).toEqual(['META-INF/container.xml', 'OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/content.opf', 'OEBPS/cover.png', 'mimetype'])
  })

  test('skips .DS_Store and iTunesMetadata.plist', () => {
    const names = Object.keys(unzipSync(zipEpubFolder(makeEpubFolder(join(dir, 'b.epub')))))
    expect(names).not.toContain('.DS_Store')
    expect(names).not.toContain('iTunesMetadata.plist')
  })

  test('readZipEntry reads one file, or null', () => {
    const bytes = zipEpubFolder(makeEpubFolder(join(dir, 'b.epub')))
    expect(Buffer.from(readZipEntry(bytes, 'mimetype')!).toString()).toBe('application/epub+zip')
    expect(readZipEntry(bytes, 'nope')).toBeNull()
  })
})

describe('toIsbn13', () => {
  test('converts an ISBN-10 with hyphens', () => expect(toIsbn13('0-306-40615-2')).toBe('9780306406157'))
  test('accepts urn:isbn:', () => expect(toIsbn13('urn:isbn:9780593083536')).toBe('9780593083536'))
  test('accepts an X check digit', () => expect(toIsbn13('080442957X')).toBe('9780804429573'))
  test('rejects a bad check digit', () => expect(toIsbn13('9780593083537')).toBeNull())
  test('rejects a uuid', () => expect(toIsbn13('urn:uuid:1234')).toBeNull())
})

describe('readEpubMetadata', () => {
  test('reads title, author, isbn and language', () => {
    const bytes = zipEpubFolder(makeEpubFolder(join(dir, 'b.epub'), { title: 'Dune', author: 'Frank Herbert', isbn: '978-0-441-01359-3', language: 'en' }))
    expect(readEpubMetadata(bytes)).toEqual({ title: 'Dune', authors: ['Frank Herbert'], isbn: '9780441013593', language: 'en' })
  })

  test('finds the cover by properties', () => {
    const md = readEpubMetadata(zipEpubFolder(makeEpubFolder(join(dir, 'b.epub'), { cover: true })))
    expect(md.cover).toEqual({ bytes: new Uint8Array(PNG_1PX), mediaType: 'image/png' })
  })

  test('finds the cover by meta name="cover"', () => {
    const md = readEpubMetadata(zipEpubFolder(makeEpubFolder(join(dir, 'b.epub'), { cover: true, coverStyle: 'meta' })))
    expect(md.cover?.mediaType).toBe('image/png')
  })

  test('a broken zip gives empty metadata', () => {
    expect(readEpubMetadata(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]))).toEqual({ authors: [] })
  })

  test('an EPUB without an OPF gives empty metadata', () => {
    const bytes = zipEpubFolder(makeEpubFolder(join(dir, 'b.epub')))
    const entries = unzipSync(bytes)
    delete entries['OEBPS/content.opf']
    expect(readEpubMetadata(zipSync(entries))).toEqual({ authors: [] })
  })
})
