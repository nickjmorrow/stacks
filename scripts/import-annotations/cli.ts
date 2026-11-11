// On the Mac. Sends Apple Books' highlights, notes and (for books in progress) last positions to the Stacks
// server, as device "apple-books". Reads Apple Books read-only; writes nothing to Grimoire.
// Re-running is safe: annotation ids are Apple Books' own.
//   pnpm import-annotations --staging <dir> --server <url>            dry run
//   pnpm import-annotations --staging <dir> --server <url> --apply

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readSpine } from '../../src/epub/spine.ts'
import type { LibraryResponse, SyncRequest } from '../../src/shared/api.ts'
import { defaultAnnotationDb, defaultLibraryDb, readAppleBooks } from '../import-apple-books/appleBooks.ts'
import type { ManifestEntry } from '../stage-files/stage.ts'
import { readAppleAnnotations } from './appleAnnotations.ts'
import { toSyncRecords, type BookInfo } from './convert.ts'

const BATCH = 500

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(args: string[]): Promise<number> {
  const staging = flag(args, '--staging')
  const server = flag(args, '--server')?.replace(/\/$/, '')
  if (!staging || !server) {
    console.error('usage: pnpm import-annotations --staging <dir> --server <url> [--apply]')
    return 1
  }
  const manifest = JSON.parse(readFileSync(join(resolve(staging), 'manifest.json'), 'utf8')) as ManifestEntry[]
  const library = (await (await fetch(`${server}/api/library`)).json()) as LibraryResponse
  const bookByAsset = new Map(library.books.flatMap((b) => (b.appleBooksId ? [[b.appleBooksId, b.bookId] as const] : [])))
  const apple = new Map(readAppleBooks(defaultLibraryDb()).map((b) => [b.assetId, b]))

  const books: Record<string, BookInfo> = {}
  for (const m of manifest) {
    const bookId = bookByAsset.get(m.assetId)
    const a = apple.get(m.assetId)
    if (!bookId || !a || !m.file.endsWith('.epub')) continue
    books[m.assetId] = {
      bookId, spine: readSpine(new Uint8Array(readFileSync(join(resolve(staging), m.file)))),
      progress: a.progress, inProgress: a.progress > 0 && !a.finished,
    }
  }
  const { annotations, positions, unplaced } = toSyncRecords(readAppleAnnotations(defaultAnnotationDb()), books)
  console.log(`books with files in Stacks: ${Object.keys(books).length}`)
  console.log(`highlights and notes: ${annotations.length} (${unplaced.length} whose chapter couldn't be found)`)
  console.log(`positions for books in progress: ${positions.length}`)
  if (!args.includes('--apply')) return 0

  for (let i = 0; i < Math.max(annotations.length, positions.length); i += BATCH) {
    const req: SyncRequest = {
      device: 'apple-books', since: 0, sessions: [],
      annotations: annotations.slice(i, i + BATCH), positions: positions.slice(i, i + BATCH),
    }
    const res = await fetch(`${server}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
    if (!res.ok) throw new Error(`the server answered ${res.status}: ${await res.text()}`)
  }
  console.log('sent.')
  return 0
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
