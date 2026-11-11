// Adds the staged files to Stacks (store and files only), each linked to the book page the Apple Books
// import made, by Apple Books ID. Never creates or changes Grimoire pages.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addFile, NoPageError, type FilesDeps } from '../../src/files/addFile.ts'
import type { ManifestEntry } from '../stage-files/stage.ts'

export async function addMany(
  deps: FilesDeps,
  manifest: ManifestEntry[],
  dir: string,
  opts: { dryRun: boolean },
): Promise<{ added: number; existing: number; noPage: string[] }> {
  const out = { added: 0, existing: 0, noPage: [] as string[] }
  const pages = new Set((await deps.grimoire.listTitles()).flatMap((t) => (t.appleBooks ? [t.appleBooks] : [])))
  for (const entry of manifest) {
    const bytes = new Uint8Array(readFileSync(join(dir, entry.file)))
    if (opts.dryRun) {
      if (deps.store.bookBySha(createHash('sha256').update(bytes).digest('hex'))) out.existing++
      else if (!pages.has(entry.assetId)) out.noPage.push(entry.title)
      else out.added++
      continue
    }
    try {
      const res = await addFile(deps, { bytes, originalName: entry.originalName, appleBooksId: entry.assetId, createPage: false })
      if (res.created) out.added++
      else out.existing++
    } catch (err) {
      if (!(err instanceof NoPageError)) throw err
      out.noPage.push(entry.title)
    }
  }
  return out
}
