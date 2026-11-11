import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readAppleBooks } from './appleBooks.ts'

describe('readAppleBooks', () => {
  it('reads books, skips hidden ones and normalizes fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoard-books-'))
    try {
      const path = join(dir, 'lib #1?.sqlite')
      const db = new DatabaseSync(path)
      db.exec(`CREATE TABLE ZBKLIBRARYASSET (ZASSETID TEXT, ZTITLE TEXT, ZAUTHOR TEXT, ZYEAR TEXT,
        ZREADINGPROGRESS REAL, ZISFINISHED INTEGER, ZISHIDDEN INTEGER, ZPATH TEXT)`)
      const ins = db.prepare('INSERT INTO ZBKLIBRARYASSET VALUES (?,?,?,?,?,?,?,?)')
      ins.run('A', 'Finished', 'Au', '1999', 1, 1, 0, '/Books/Finished.epub')
      ins.run('B', 'Fresh', null, null, null, null, null, null)
      ins.run('C', 'Hidden', null, null, 0, null, 1, null)
      ins.run('D', 'Odd year', '', 'n/a', 0.2, null, 0, null)
      ins.run('E', 'Flip', 'Le Guin, Ursula', null, 0, null, 0, null)
      ins.run('F', 'Multi', 'Smith, John, Jr.', null, 0, null, 0, null)
      db.close()
      expect(readAppleBooks(path)).toEqual([
        { assetId: 'A', title: 'Finished', author: 'Au', year: 1999, progress: 1, finished: true, path: '/Books/Finished.epub' },
        { assetId: 'B', title: 'Fresh', progress: 0, finished: false },
        { assetId: 'D', title: 'Odd year', progress: 0.2, finished: false },
        { assetId: 'E', title: 'Flip', author: 'Ursula Le Guin', progress: 0, finished: false },
        { assetId: 'F', title: 'Multi', author: 'Smith, John, Jr.', progress: 0, finished: false },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
