// Apple Books stores positions as EPUB CFIs ("epubcfi(/6/14[Chapter_1]!/4/2,:187,:307)"). The first
// step after /6 picks the spine item (even numbers, 2 = first); that's enough to find the chapter,
// and Readium finds the exact spot from the highlighted text.

import type { Locator } from '../../src/shared/api.ts'

/** The chapter of a CFI as a Readium locator, or null when the CFI doesn't point into the spine. */
export function cfiToLocator(cfi: string, spineHrefs: string[], text: string | null): Locator | null {
  const href = cfiHref(cfi, spineHrefs)
  if (!href) return null
  return { href, type: 'application/xhtml+xml', locations: {}, ...(text ? { text: { highlight: text } } : {}) }
}

export function cfiHref(cfi: string, spineHrefs: string[]): string | null {
  const m = /^epubcfi\(\/6\/(\d+)/.exec(cfi.trim())
  if (!m) return null
  const step = Number(m[1])
  if (step < 2 || step % 2 !== 0) return null
  return spineHrefs[step / 2 - 1] ?? null
}
