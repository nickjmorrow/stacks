// Telling whether two titles are the same book: the owner's own file and a Book Store edition with a
// subtitle, or an upload of a book that already has a page ("Dune: Deluxe Edition" by "Herbert, Frank"
// is "Dune (1965)" by Frank Herbert). One page per book.

/** Drops edition suffixes Apple Books adds: (Unabridged), (Abridged), (ISBN). */
export function cleanTitle(title: string): string {
  let t = title.trim()
  for (;;) {
    const next = t.replace(/\s*\((?:unabridged|abridged|\d{10,13})\)\s*$/i, '').trim()
    if (next === t || next === '') return t
    t = next
  }
}

/** Comparison key: lowercase, punctuation and whitespace collapsed. */
export const lc = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The title before any subtitle, without a page name's " (Year)" or " (book)": "Walden: Or, Life in the Woods (1854)" → "walden". */
export function mainTitle(s: string): string {
  const bare = cleanTitle(s).replace(/\s*\((?:\d{4}|book)\)\s*$/i, '')
  return lc(bare.split(/\s*:\s*/)[0] ?? '')
}

const NOT_NAMES = new Set(['phd', 'psyd', 'md', 'jr', 'sr', 'dr', 'and', 'the'])
const authorWords = (a?: string) => new Set(lc(a ?? '').split(' ').filter((w) => w.length >= 3 && !NOT_NAMES.has(w)))

/** Two author strings share a name ("Lionel Giles Ph.D. & Sun Tzu" and "Sun Tzu"). */
export function sharesAuthor(a?: string, b?: string): boolean {
  const wa = authorWords(a)
  return [...authorWords(b)].some((w) => wa.has(w))
}

/** Same main title and a shared author name. */
export function sameWork(titleA: string, authorA: string | undefined, titleB: string, authorB: string | undefined): boolean {
  return mainTitle(titleA) === mainTitle(titleB) && sharesAuthor(authorA, authorB)
}
