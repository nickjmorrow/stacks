// ISBNs (a book's catalog number) as found in EPUB identifiers, checked and turned into 13 digits.

/** ISBN-10 or -13, with hyphens, spaces or a `urn:isbn:` / `isbn:` prefix, to 13 digits; null if not a valid ISBN. */
export function toIsbn13(raw: string): string | null {
  const s = raw.trim().replace(/^(urn:)?isbn:?/i, '').replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{13}$/.test(s)) return (s.startsWith('978') || s.startsWith('979')) && check13(s.slice(0, 12)) === s[12] ? s : null
  if (/^\d{9}[\dX]$/.test(s)) {
    if (check10(s.slice(0, 9)) !== s[9]) return null
    const body = '978' + s.slice(0, 9)
    return body + check13(body)
  }
  return null
}

function check13(twelve: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3)
  return String((10 - (sum % 10)) % 10)
}

function check10(nine: string): string {
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(nine[i]) * (10 - i)
  const c = (11 - (sum % 11)) % 11
  return c === 10 ? 'X' : String(c)
}
