// The Inbox folder on the server: drop an EPUB or PDF in and it joins the library.

import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GrimError } from '../grimoire/grim.ts'
import { addFile, type FilesDeps } from './addFile.ts'

/** A file changed this recently may still be copying in. */
const SETTLE_MS = 30_000

export async function scanInbox(deps: FilesDeps): Promise<{ added: number; failed: number }> {
  const inbox = join(deps.home, 'Inbox')
  mkdirSync(inbox, { recursive: true })
  let added = 0
  let failed = 0
  for (const name of readdirSync(inbox).sort()) {
    const full = join(inbox, name)
    if (name.startsWith('.')) continue
    const st = statSync(full)
    if (!st.isFile() || deps.now() - st.mtimeMs < SETTLE_MS) continue
    try {
      await addFile(deps, { bytes: new Uint8Array(readFileSync(full)), originalName: name })
      moveTo(inbox, 'Added', name)
      added++
    } catch (err) {
      if (err instanceof GrimError) continue // Grimoire is busy or down: try again next pass
      const dest = moveTo(inbox, 'Failed', name)
      writeFileSync(`${dest}.error.txt`, `${err instanceof Error ? err.message : String(err)}\n`)
      failed++
    }
  }
  return { added, failed }
}

function moveTo(inbox: string, folder: string, name: string): string {
  mkdirSync(join(inbox, folder), { recursive: true })
  const dest = join(inbox, folder, name)
  renameSync(join(inbox, name), dest)
  return dest
}
