// The shape of a book's title page in Grimoire, as Stacks sees it.
// Hoard (movies, shows, games) uses the same page format for its own types; each app only
// recognizes its own `type` values, so neither touches the other's pages. Format: docs/title-page-format.md.

export type MediaType = 'book'
export type Status = 'want' | 'doing' | 'done' | 'dropped'

export const MEDIA_TYPES: readonly MediaType[] = ['book']
export const STATUSES: readonly Status[] = ['want', 'doing', 'done', 'dropped']

export interface Title {
  pageId: string
  pageTitle: string
  /** pageTitle without a trailing " (Year)". */
  name: string
  type: MediaType
  /** want = to read, doing = reading, done = read, dropped = gave up */
  status: Status
  /** Tag page titles, without [[media]]. */
  tags: string[]
  rating?: number
  rec?: string
  /** YYYY-MM-DD */
  finished?: string
  progress?: string
  year?: number
  genre?: string[]
  summary?: string
  author?: string
  appleBooks?: string
  /** Text of every block except the property block, joined with newlines. */
  notesText: string
  /** ms since epoch */
  updatedAt: number
  /** ms since epoch */
  createdAt: number
}

/** Property keys Stacks reads and writes on a book page (tags are handled separately). */
export type FieldKey =
  | 'type' | 'status' | 'rating' | 'rec' | 'finished' | 'progress'
  | 'year' | 'genre' | 'summary' | 'author' | 'apple-books'

/** The tag that marks a page as a title (shared with Hoard). */
export const MEDIA_TAG = 'media'
