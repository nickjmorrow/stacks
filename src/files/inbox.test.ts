import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEpubFolder } from '../../test/fixtures/makeEpub.ts'
import { zipEpubFolder } from '../epub/zip.ts'
import { FakeGrimoire } from '../library/fakeGrimoire.ts'
import { Store } from '../store/store.ts'
import { scanInbox } from './inbox.ts'

test('moves added files to Added and bad ones to Failed with an error note', async () => {
  const home = mkdtempSync(join(tmpdir(), 'stacks-inbox-'))
  const store = new Store(':memory:')
  try {
    const inbox = join(home, 'Inbox')
    mkdirSync(inbox, { recursive: true })
    writeFileSync(join(inbox, 'Dune.epub'), zipEpubFolder(makeEpubFolder(join(home, 'tmp.epub'), { title: 'Dune' })))
    writeFileSync(join(inbox, 'notes.txt'), 'not a book')
    writeFileSync(join(inbox, '.DS_Store'), 'junk')
    mkdirSync(join(inbox, 'some folder'))
    const deps = { store, grimoire: new FakeGrimoire(), home, fetch: async () => new Response('', { status: 404 }), now: () => Date.now() + 120_000 }
    expect(await scanInbox(deps)).toEqual({ added: 1, failed: 1 })
    expect(existsSync(join(inbox, 'Added', 'Dune.epub'))).toBe(true)
    expect(existsSync(join(inbox, 'Failed', 'notes.txt'))).toBe(true)
    expect(readFileSync(join(inbox, 'Failed', 'notes.txt.error.txt'), 'utf8')).toMatch(/not an EPUB or PDF/)
    expect(existsSync(join(inbox, '.DS_Store'))).toBe(true)
    expect(await scanInbox(deps)).toEqual({ added: 0, failed: 0 })
  } finally {
    store.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('a file still being copied in (changed in the last 30 s) waits for the next pass', async () => {
  const home = mkdtempSync(join(tmpdir(), 'stacks-inbox-'))
  const store = new Store(':memory:')
  try {
    mkdirSync(join(home, 'Inbox'), { recursive: true })
    writeFileSync(join(home, 'Inbox', 'Dune.epub'), zipEpubFolder(makeEpubFolder(join(home, 'tmp.epub'), { title: 'Dune' })))
    const deps = { store, grimoire: new FakeGrimoire(), home, fetch: async () => new Response('', { status: 404 }), now: () => Date.now() }
    expect(await scanInbox(deps)).toEqual({ added: 0, failed: 0 })
    expect(existsSync(join(home, 'Inbox', 'Dune.epub'))).toBe(true)
  } finally {
    store.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('when grim is down the file stays in the Inbox for the next pass', async () => {
  const home = mkdtempSync(join(tmpdir(), 'stacks-inbox-'))
  const store = new Store(':memory:')
  try {
    mkdirSync(join(home, 'Inbox'), { recursive: true })
    writeFileSync(join(home, 'Inbox', 'Dune.epub'), zipEpubFolder(makeEpubFolder(join(home, 'tmp.epub'), { title: 'Dune' })))
    const grimoire = new FakeGrimoire()
    grimoire.failing = true
    const deps = { store, grimoire, home, fetch: async () => new Response('', { status: 404 }), now: () => Date.now() + 120_000 }
    expect(await scanInbox(deps)).toEqual({ added: 0, failed: 0 })
    expect(existsSync(join(home, 'Inbox', 'Dune.epub'))).toBe(true)
  } finally {
    store.close()
    rmSync(home, { recursive: true, force: true })
  }
})
