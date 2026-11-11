// Copies the owner's own Apple Books files (not Book Store items) into a staging folder, zipping the
// unpacked EPUB folders, and writes a manifest linking each file to its Apple Books ID.
// Only reads Apple Books' folder.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, sep } from 'node:path'
import { zipEpubFolder } from '../../src/epub/zip.ts'
import type { AppleBook } from '../import-apple-books/appleBooks.ts'

export const BOOKS_FOLDER = join(homedir(), 'Library/Mobile Documents/iCloud~com~apple~iBooks/Documents')

export interface ManifestEntry {
  assetId: string
  title: string
  /** File name inside the staging folder */
  file: string
  sha256: string
  /** The file's name in Apple Books' folder */
  originalName: string
}

export function stageFiles(books: AppleBook[], outDir: string, booksFolder = BOOKS_FOLDER): { manifest: ManifestEntry[]; skipped: string[] } {
  mkdirSync(outDir, { recursive: true })
  const manifest: ManifestEntry[] = []
  const skipped: string[] = []
  for (const b of books) {
    if (!b.path) continue
    if (!b.path.startsWith(booksFolder + sep)) {
      skipped.push(`${b.title}: not in the Books folder`)
      continue
    }
    if (!existsSync(b.path)) {
      skipped.push(`${b.title}: file missing`)
      continue
    }
    const ext = extname(b.path).toLowerCase()
    if (ext !== '.epub' && ext !== '.pdf') {
      skipped.push(`${b.title}: not an EPUB or PDF`)
      continue
    }
    const bytes = statSync(b.path).isDirectory() ? zipEpubFolder(b.path) : new Uint8Array(readFileSync(b.path))
    const file = `${b.assetId}${ext}`
    writeFileSync(join(outDir, file), bytes)
    manifest.push({ assetId: b.assetId, title: b.title, file, sha256: createHash('sha256').update(bytes).digest('hex'), originalName: basename(b.path) })
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { manifest, skipped }
}
