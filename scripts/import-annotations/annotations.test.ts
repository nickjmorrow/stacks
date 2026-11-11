import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeEpubFolder } from '../../test/fixtures/makeEpub.ts'
import { readSpine } from '../../src/epub/spine.ts'
import { zipEpubFolder } from '../../src/epub/zip.ts'
import { readAppleAnnotations } from './appleAnnotations.ts'
import { cfiToLocator } from './cfi.ts'
import { toSyncRecords } from './convert.ts'

const HREFS = Array.from({ length: 12 }, (_, i) => `OEBPS/ch${i + 1}.xhtml`)

describe('cfiToLocator', () => {
  test('the spine step /6/14 is the seventh spine item', () => {
    expect(cfiToLocator('epubcfi(/6/14[Chapter_1]!/4/2/30/5,:187,:307)', HREFS, 'quoted')).toEqual({
      href: 'OEBPS/ch7.xhtml', type: 'application/xhtml+xml', locations: {}, text: { highlight: 'quoted' },
    })
  })
  test('a CFI past the spine is null', () => expect(cfiToLocator('epubcfi(/6/40!/4/2)', HREFS, 'x')).toBeNull())
  test('garbage is null', () => expect(cfiToLocator('not a cfi', HREFS, 'x')).toBeNull())
})

test('readSpine lists the spine documents in order, from the archive root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stacks-spine-'))
  try {
    expect(readSpine(zipEpubFolder(makeEpubFolder(join(dir, 'b.epub'), { chapters: 3 })))).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/ch3.xhtml'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Apple Books annotations', () => {
  let dir: string
  let dbPath: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'stacks-ann-'))
    dbPath = join(dir, 'AEAnnotation.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`CREATE TABLE ZAEANNOTATION (ZANNOTATIONDELETED INTEGER, ZANNOTATIONSTYLE INTEGER, ZANNOTATIONTYPE INTEGER,
      ZANNOTATIONCREATIONDATE TIMESTAMP, ZANNOTATIONMODIFICATIONDATE TIMESTAMP, ZANNOTATIONASSETID VARCHAR,
      ZANNOTATIONLOCATION VARCHAR, ZANNOTATIONNOTE VARCHAR, ZANNOTATIONSELECTEDTEXT VARCHAR, ZANNOTATIONUUID VARCHAR)`)
    const ins = db.prepare('INSERT INTO ZAEANNOTATION VALUES (?,?,?,?,?,?,?,?,?,?)')
    ins.run(0, 3, 2, 0, 10, 'E1', 'epubcfi(/6/4!/4/2,:0,:5)', null, 'Hello', 'AAA-1')
    ins.run(0, 4, 2, 100, 200, 'E1', 'epubcfi(/6/2!/4/2,:0,:5)', 'my note', 'World', 'BBB-2')
    ins.run(1, 3, 2, 0, 0, 'E1', 'epubcfi(/6/2!/4)', null, 'deleted', 'CCC-3')
    ins.run(0, 0, 3, 0, 300, 'E1', 'epubcfi(/6/4!/4/2/1,:0,:1)', null, null, 'DDD-4')
    ins.run(0, 0, 1, 0, 0, 'E1', 'epubcfi(/6/4!/4)', null, null, 'EEE-5')
    db.close()
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('reads highlights and last locations, converting dates and skipping deleted rows and bookmarks', () => {
    expect(readAppleAnnotations(dbPath)).toEqual([
      { uuid: 'AAA-1', assetId: 'E1', type: 'highlight', cfi: 'epubcfi(/6/4!/4/2,:0,:5)', text: 'Hello', note: null, style: 3, createdAt: 978307200000, updatedAt: 978307210000 },
      { uuid: 'BBB-2', assetId: 'E1', type: 'highlight', cfi: 'epubcfi(/6/2!/4/2,:0,:5)', text: 'World', note: 'my note', style: 4, createdAt: 978307300000, updatedAt: 978307400000 },
      { uuid: 'DDD-4', assetId: 'E1', type: 'location', cfi: 'epubcfi(/6/4!/4/2/1,:0,:1)', text: null, note: null, style: 0, createdAt: 978307200000, updatedAt: 978307500000 },
    ])
  })

  test('toSyncRecords makes annotations with colors and kinds, and positions for books in progress', () => {
    const records = toSyncRecords(readAppleAnnotations(dbPath), {
      E1: { bookId: 'b1', spine: ['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml'], progress: 0.4, inProgress: true },
    })
    expect(records.annotations).toEqual([
      expect.objectContaining({ annotationId: 'aaa-1', bookId: 'b1', kind: 'highlight', color: 'yellow', text: 'Hello', device: 'apple-books', source: 'apple-books', locator: expect.objectContaining({ href: 'OEBPS/ch2.xhtml' }) }),
      expect.objectContaining({ annotationId: 'bbb-2', kind: 'note', color: 'pink', note: 'my note', locator: expect.objectContaining({ href: 'OEBPS/ch1.xhtml' }) }),
    ])
    expect(records.positions).toEqual([
      { bookId: 'b1', device: 'apple-books', progression: 0.4, updatedAt: 978307500000, locator: { href: 'OEBPS/ch2.xhtml', type: 'application/xhtml+xml', locations: { totalProgression: 0.4 } } },
    ])
    expect(records.unplaced).toEqual([])
  })

  test('a book not in progress gets no position, and an unknown book is skipped', () => {
    const records = toSyncRecords(readAppleAnnotations(dbPath), {
      E1: { bookId: 'b1', spine: ['OEBPS/ch1.xhtml'], progress: 1, inProgress: false },
    })
    expect(records.positions).toEqual([])
    expect(records.unplaced).toEqual(['aaa-1'])
    expect(toSyncRecords(readAppleAnnotations(dbPath), {}).annotations).toEqual([])
  })
})
