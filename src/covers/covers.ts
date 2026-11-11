// Book covers: kept on the server as 600 px tall JPEGs, never in Grimoire.

import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { LOOKUP_TIMEOUT_MS, type FetchLike } from '../lookup/lookupError.ts'

const run = promisify(execFile)

/** Resizes any image macOS can read to 600 px tall and saves it as JPEG, using sips (built into macOS). */
export async function saveCover(bytes: Uint8Array, outPath: string): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'stacks-cover-'))
  try {
    const input = join(tmp, 'in')
    writeFileSync(input, bytes)
    mkdirSync(dirname(outPath), { recursive: true })
    await run('sips', ['--resampleHeight', '600', '-s', 'format', 'jpeg', input, '--out', outPath], { timeout: LOOKUP_TIMEOUT_MS })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Open Library's large cover for an ISBN, or null when it has none or can't be reached. */
export async function fetchOpenLibraryCover(isbn: string, fetchFn: FetchLike): Promise<Uint8Array | null> {
  try {
    const res = await fetchFn(`https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytes.length > 0 ? bytes : null
  } catch {
    return null
  }
}
