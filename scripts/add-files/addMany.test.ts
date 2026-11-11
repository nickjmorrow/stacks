import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEpubFolder } from '../../test/fixtures/makeEpub.ts'
import { zipEpubFolder } from '../../src/epub/zip.ts'
import type { FilesDeps } from '../../src/files/addFile.ts'
import { FakeGrimoire, title } from '../../src/library/fakeGrimoire.ts'
import { Store } from '../../src/store/store.ts'
import type { ManifestEntry } from '../stage-files/stage.ts'
import { addMany } from './addMany.ts'

let dir: string
let store: Store
let deps: FilesDeps
let manifest: ManifestEntry[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stacks-addmany-'))
  store = new Store(':memory:')
  const g = new FakeGrimoire([title({ pageId: 'p1', pageTitle: 'Dune (1965)', appleBooks: 'E1' })])
  deps = { store, grimoire: g, home: join(dir, 'home'), fetch: async () => new Response('', { status: 404 }), now: () => 1 }
  writeFileSync(join(dir, 'E1.epub'), zipEpubFolder(makeEpubFolder(join(dir, 'a.epub'), { title: 'Dune' })))
  writeFileSync(join(dir, 'E2.epub'), zipEpubFolder(makeEpubFolder(join(dir, 'b.epub'), { title: 'Orphan' })))
  manifest = [
    { assetId: 'E1', title: 'Dune', file: 'E1.epub', sha256: 'x', originalName: 'Dune.epub' },
    { assetId: 'E2', title: 'Orphan', file: 'E2.epub', sha256: 'y', originalName: 'Orphan.epub' },
  ]
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a dry run adds nothing and reports books with no page', async () => {
  expect(await addMany(deps, manifest, dir, { dryRun: true })).toEqual({ added: 1, existing: 0, noPage: ['Orphan'] })
  expect(store.listBooks()).toEqual([])
})

test('a real run adds books linked by Apple Books ID, and a re-run finds them existing', async () => {
  expect(await addMany(deps, manifest, dir, { dryRun: false })).toEqual({ added: 1, existing: 0, noPage: ['Orphan'] })
  expect(store.listBooks().map((b) => [b.pageId, b.appleBooksId])).toEqual([['p1', 'E1']])
  expect(await addMany(deps, manifest, dir, { dryRun: false })).toEqual({ added: 0, existing: 1, noPage: ['Orphan'] })
})
