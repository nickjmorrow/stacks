// The JSON the Stacks server and its clients exchange. The Swift app decodes the same shapes
// (app-fixtures/ holds real responses written by the server tests).

import type { TagInfo } from '../grimoire/grimoire.ts'
import type { Status } from './title.ts'

export type Format = 'epub' | 'pdf'
export type LookupState = 'pending' | 'done' | 'needs_look' | 'failed'
export type AnnotationKind = 'highlight' | 'note'
export type Color = 'yellow' | 'blue' | 'green' | 'pink' | 'purple'
export const COLORS: readonly Color[] = ['yellow', 'blue', 'green', 'pink', 'purple']

/** A Readium Locator (href, type, locations, text). The server stores it as is. */
export type Locator = Record<string, unknown>

/** Where one device is in one book. */
export interface Position {
  bookId: string
  device: string
  locator: Locator
  /** 0 to 1 through the whole book */
  progression: number
  /** ms since epoch */
  updatedAt: number
}

/** One stretch of reading, for the reading log. */
export interface Session {
  sessionId: string
  bookId: string
  device: string
  startedAt: number
  endedAt: number
  activeSeconds: number
  startProgression: number
  endProgression: number
  pagesTurned: number
}

export interface Annotation {
  annotationId: string
  bookId: string
  kind: AnnotationKind
  color: Color
  locator: Locator
  /** The selected text */
  text: string
  note: string | null
  createdAt: number
  updatedAt: number
  /** Set when deleted; the row stays so the delete reaches other devices. */
  deletedAt: number | null
  device: string
  source: 'stacks' | 'apple-books'
}

export interface SyncRequest {
  device: string
  /** The cursor from the last answer, 0 the first time. */
  since: number
  positions: Position[]
  sessions: Session[]
  annotations: Annotation[]
  /** The book just closed: only then is its progress written to Grimoire. */
  closing?: string
}

export interface SyncResponse {
  cursor: number
  positions: Position[]
  sessions: Session[]
  annotations: Annotation[]
}

/** A book in the library: its Grimoire page's fields plus what Stacks keeps about the file. */
export interface LibraryBook {
  bookId: string
  pageId: string
  pageTitle: string
  name: string
  status: Status
  tags: string[]
  rating?: number
  rec?: string
  finished?: string
  progress?: string
  year?: number
  genre?: string[]
  summary?: string
  author?: string
  format: Format
  fileSize: number
  fileSha256: string
  coverUrl: string | null
  isbn?: string
  /** Set for books that came from Apple Books */
  appleBooksId?: string
  addedAt: number
  lookupState: LookupState
  lastReadAt: number | null
  /** An edit is waiting to reach Grimoire. */
  pendingEdit: boolean
}

export interface LibraryResponse {
  books: LibraryBook[]
  tags: TagInfo[]
  cursor: number
}
