// Open Library subjects are long and messy ("Fiction, science fiction, general"); this keeps a short genre.

const RULES: [RegExp, string][] = [
  [/science fiction/, 'Science Fiction'],
  [/fantasy/, 'Fantasy'],
  [/horror/, 'Horror'],
  [/mystery|detective/, 'Mystery'],
  [/thriller|suspense/, 'Thriller'],
  [/romance/, 'Romance'],
  [/historical fiction/, 'Historical Fiction'],
  [/biography|autobiography/, 'Biography'],
  [/memoir/, 'Memoir'],
  [/philosophy/, 'Philosophy'],
  [/psychology/, 'Psychology'],
  [/self-help|self-actualization/, 'Self-Help'],
  [/computer|programming|software/, 'Programming'],
  [/business|management/, 'Business'],
  [/history/, 'History'],
  [/\bscience\b(?! fiction)/, 'Science'],
  [/poetry/, 'Poetry'],
  [/comic|graphic novel/, 'Graphic Novel'],
]

/** Up to two genres, in rule order; "Fiction" only when nothing more specific matched. */
export function genreFromSubjects(subjects: string[]): string | undefined {
  const text = subjects.map((s) => s.toLowerCase())
  const found = RULES.filter(([re]) => text.some((s) => re.test(s))).map(([, g]) => g).slice(0, 2)
  if (found.length === 0 && text.some((s) => /\bfiction\b/.test(s))) return 'Fiction'
  return found.length ? found.join(', ') : undefined
}
