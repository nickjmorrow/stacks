// What the API needs from the enricher; the real one is in enricher.ts, tests pass a fake.

import type { LookupResult } from '../lookup/ports.ts'

export interface NeedsLookItem { bookId: string; pageTitle: string; candidates: LookupResult[] }

export interface EnricherPort {
  needsLook(): Promise<NeedsLookItem[]>
  /** Apply the Open Library work the user picked for a book. */
  match(bookId: string, workId: string): Promise<void>
  /** Look the book up soon, without waiting. */
  enrichSoon(bookId: string): void
}
