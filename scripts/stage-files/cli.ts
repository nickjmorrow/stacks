// On the Mac only. Copies the owner's own Apple Books files into a staging folder (EPUB folders zipped)
// with manifest.json, ready to rsync to the server. Only reads Apple Books' library and folder.
//   pnpm stage-files --out <dir>

import { resolve } from 'node:path'
import { defaultLibraryDb, readAppleBooks } from '../import-apple-books/appleBooks.ts'
import { stageFiles } from './stage.ts'

const i = process.argv.indexOf('--out')
const out = i >= 0 ? process.argv[i + 1] : undefined
if (!out) {
  console.error('usage: pnpm stage-files --out <dir>')
  process.exit(1)
}
const { manifest, skipped } = stageFiles(readAppleBooks(defaultLibraryDb()), resolve(out))
console.log(`staged ${manifest.length} files in ${resolve(out)} (manifest.json written)`)
for (const s of skipped) console.log(`  skipped: ${s}`)
