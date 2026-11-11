// Reads the Apple Books library database on this Mac. Strictly read-only: never write to it.

import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export interface AppleBook {
  assetId: string
  title: string
  author?: string
  year?: number
  /** 0 to 1 */
  progress: number
  finished: boolean
  /** Where the file is on this Mac; absent for Book Store items not downloaded here. */
  path?: string
}

interface Row {
  ZASSETID: string | null
  ZTITLE: string | null
  ZAUTHOR: string | null
  ZYEAR: string | number | null
  ZREADINGPROGRESS: number | null
  ZISFINISHED: number | null
  ZPATH: string | null
}

/** "Last, First" (one comma, nothing else) becomes "First Last". */
function flipAuthor(a: string | undefined): string | undefined {
  if (!a) return a
  const parts = a.split(',')
  if (parts.length !== 2) return a
  const [last, first] = parts.map((p) => p.trim()) as [string, string]
  return last && first ? `${first} ${last}` : a
}

/** Apple Books' library database on this Mac. */
export function defaultLibraryDb(): string {
  return onlyFile(join(homedir(), 'Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary'), /^BKLibrary-.*\.sqlite$/)
}

/** Apple Books' highlights database on this Mac. */
export function defaultAnnotationDb(): string {
  return onlyFile(join(homedir(), 'Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation'), /^AEAnnotation_.*\.sqlite$/)
}

function onlyFile(dir: string, re: RegExp): string {
  const found = readdirSync(dir).filter((f) => re.test(f))
  if (found.length !== 1) throw new Error(`expected exactly one ${re.source} in ${dir}, found ${found.length}`)
  return join(dir, found[0]!)
}

export function readAppleBooks(dbPath: string): AppleBook[] {
  const db = new DatabaseSync(pathToFileURL(dbPath).href + '?mode=ro&immutable=1', { readOnly: true })
  try {
    const rows = db
      .prepare(
        `SELECT ZASSETID, ZTITLE, ZAUTHOR, ZYEAR, ZREADINGPROGRESS, ZISFINISHED, ZPATH
         FROM ZBKLIBRARYASSET
         WHERE COALESCE(ZISHIDDEN, 0) != 1
         ORDER BY ZASSETID`,
      )
      .all() as unknown as Row[]
    const books: AppleBook[] = []
    for (const r of rows) {
      const assetId = r.ZASSETID?.trim()
      const title = r.ZTITLE?.trim()
      if (!assetId || !title) continue
      const book: AppleBook = { assetId, title, progress: r.ZREADINGPROGRESS ?? 0, finished: r.ZISFINISHED === 1 }
      const author = flipAuthor(r.ZAUTHOR?.trim())
      if (author) book.author = author
      const m = /\b(\d{4})\b/.exec(String(r.ZYEAR ?? ''))
      if (m) book.year = Number(m[1])
      const path = r.ZPATH?.trim()
      if (path) book.path = path
      books.push(book)
    }
    return books
  } finally {
    db.close()
  }
}
