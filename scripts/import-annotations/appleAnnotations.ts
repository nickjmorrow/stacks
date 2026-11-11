// Reads Apple Books' highlights, notes and last reading locations on this Mac. Strictly read-only.

import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export interface AppleAnnotation {
  uuid: string
  assetId: string
  /** highlight (with or without a note), or the book's last reading location */
  type: 'highlight' | 'location'
  cfi: string
  text: string | null
  note: string | null
  /** Apple Books' color number */
  style: number
  /** ms since epoch */
  createdAt: number
  updatedAt: number
}

/** Core Data counts seconds from 2001-01-01. */
const APPLE_EPOCH_S = 978_307_200
const toMs = (s: number | null) => Math.round(((s ?? 0) + APPLE_EPOCH_S) * 1000)

interface Row {
  ZANNOTATIONTYPE: number
  ZANNOTATIONSTYLE: number | null
  ZANNOTATIONCREATIONDATE: number | null
  ZANNOTATIONMODIFICATIONDATE: number | null
  ZANNOTATIONASSETID: string | null
  ZANNOTATIONLOCATION: string | null
  ZANNOTATIONNOTE: string | null
  ZANNOTATIONSELECTEDTEXT: string | null
  ZANNOTATIONUUID: string | null
}

export function readAppleAnnotations(dbPath: string): AppleAnnotation[] {
  // No immutable=1: it would miss changes Apple Books hasn't checkpointed yet.
  const db = new DatabaseSync(pathToFileURL(dbPath).href + '?mode=ro', { readOnly: true })
  try {
    const rows = db.prepare(`
      SELECT ZANNOTATIONTYPE, ZANNOTATIONSTYLE, ZANNOTATIONCREATIONDATE, ZANNOTATIONMODIFICATIONDATE, ZANNOTATIONASSETID,
             ZANNOTATIONLOCATION, ZANNOTATIONNOTE, ZANNOTATIONSELECTEDTEXT, ZANNOTATIONUUID
      FROM ZAEANNOTATION
      WHERE COALESCE(ZANNOTATIONDELETED, 0) = 0 AND ZANNOTATIONTYPE IN (2, 3)
      ORDER BY ZANNOTATIONTYPE, ZANNOTATIONASSETID, ZANNOTATIONCREATIONDATE`).all() as unknown as Row[]
    const out: AppleAnnotation[] = []
    for (const r of rows) {
      const type = r.ZANNOTATIONTYPE === 2 ? 'highlight' : 'location'
      const text = r.ZANNOTATIONSELECTEDTEXT?.trim() || null
      if (!r.ZANNOTATIONUUID || !r.ZANNOTATIONASSETID || !r.ZANNOTATIONLOCATION) continue
      if (type === 'highlight' && !text) continue
      out.push({
        uuid: r.ZANNOTATIONUUID, assetId: r.ZANNOTATIONASSETID, type, cfi: r.ZANNOTATIONLOCATION, text,
        note: r.ZANNOTATIONNOTE?.trim() || null, style: r.ZANNOTATIONSTYLE ?? 0,
        createdAt: toMs(r.ZANNOTATIONCREATIONDATE), updatedAt: toMs(r.ZANNOTATIONMODIFICATIONDATE),
      })
    }
    return out
  } finally {
    db.close()
  }
}
