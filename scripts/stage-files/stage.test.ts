import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { makeEpubFolder, minimalPdf } from '../../test/fixtures/makeEpub.ts'
import type { AppleBook } from '../import-apple-books/appleBooks.ts'
import { stageFiles } from './stage.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'stacks-stage-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('zips a folder EPUB, copies a PDF, and skips Book Store items and missing files', () => {
  const docs = join(dir, 'Documents')
  mkdirSync(docs)
  makeEpubFolder(join(docs, 'Dune.epub'), { title: 'Dune' })
  writeFileSync(join(docs, 'Field Guide.pdf'), minimalPdf())
  const books: AppleBook[] = [
    { assetId: 'E1', title: 'Dune', progress: 0, finished: false, path: join(docs, 'Dune.epub') },
    { assetId: 'P1', title: 'Field Guide', progress: 0, finished: false, path: join(docs, 'Field Guide.pdf') },
    { assetId: '1000000001', title: 'Store Book', progress: 0, finished: false },
    { assetId: 'X1', title: 'Gone', progress: 0, finished: false, path: join(docs, 'Gone.epub') },
    { assetId: 'O1', title: 'Elsewhere', progress: 0, finished: false, path: '/tmp/Elsewhere.epub' },
  ]
  const out = join(dir, 'staging')
  const { manifest, skipped } = stageFiles(books, out, docs)
  expect(manifest.map((m) => [m.assetId, m.file, m.originalName])).toEqual([
    ['E1', 'E1.epub', 'Dune.epub'],
    ['P1', 'P1.pdf', 'Field Guide.pdf'],
  ])
  const epub = readFileSync(join(out, 'E1.epub'))
  expect(Object.keys(unzipSync(epub))).toContain('OEBPS/content.opf')
  expect(manifest[0]?.sha256).toBe(createHash('sha256').update(epub).digest('hex'))
  expect(readFileSync(join(out, 'P1.pdf'))).toEqual(minimalPdf())
  expect(skipped).toEqual(['Gone: file missing', 'Elsewhere: not in the Books folder'])
  expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(manifest)
})
