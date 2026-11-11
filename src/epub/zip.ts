// EPUB files are zips. Apple Books keeps them unpacked as folders, so they are zipped again here.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { unzipSync, zipSync, type Zippable } from 'fflate'

const SKIP = new Set(['.DS_Store', 'iTunesMetadata.plist', 'iTunesMetadata-original.plist'])

/** Zips an unpacked EPUB folder: `mimetype` first and stored, as the EPUB format requires; the rest deflated. */
export function zipEpubFolder(dir: string): Uint8Array {
  const files: Zippable = { mimetype: [readFileSync(join(dir, 'mimetype')), { level: 0 }] }
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP.has(name)) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else {
        const rel = relative(dir, full).split(sep).join('/')
        if (rel !== 'mimetype') files[rel] = [readFileSync(full), { level: 6 }]
      }
    }
  }
  walk(dir)
  return zipSync(files)
}

/** One entry's bytes, or null when the zip lacks it or can't be read. */
export function readZipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  try {
    return unzipSync(bytes, { filter: (f) => f.name === name })[name] ?? null
  } catch {
    return null
  }
}
