// One-off: turn the old Grimoire `books` list page into book title pages. Run on the Mac against
// ~/Grimoire (or $GRIMOIRE_GRAPH). Writes are recorded as author `claude`, so grimoire_undo_claude reverts them.
//
//   pnpm migrate --snapshot <file>          save a fresh `grim page books --json` copy
//   pnpm migrate --dry-run [--from <file>]  write migration-report.md (default: the fixture); with --from, list name collisions too
//   pnpm migrate --apply --from <file>      ask for a typed "yes", then write

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { grim } from '../../src/grimoire/grim.ts'
import { Grimoire } from '../../src/grimoire/grimoire.ts'
import { confirm, existingPages, findCollisions, useGraph } from '../lib/live.ts'
import { applyBooks } from './apply.ts'
import { parseBooksPage, type Block } from './booksPage.ts'

const repoRoot = resolve(import.meta.dirname, '../..')
const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const load = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { blocks: Block[] }).blocks

async function main(args: string[]): Promise<number> {
  const snap = flag(args, '--snapshot')
  if (snap) {
    useGraph()
    writeFileSync(resolve(snap), JSON.stringify(await grim(['page', 'books']), null, 2))
    console.log(`saved the books page to ${resolve(snap)}`)
    return 0
  }
  const from = flag(args, '--from')
  const { books, skipped } = parseBooksPage(load(resolve(from ?? join(import.meta.dirname, 'fixtures/books.json'))))
  const byStatus = Object.entries(Object.groupBy(books, (b) => b.fields.status ?? '?')).map(([k, v]) => `${k} ${v!.length}`).join(', ')
  console.log(`${books.length} books (${byStatus}), ${skipped.length} lines skipped`)

  if (args.includes('--apply')) {
    if (!from) { console.error('--apply needs --from <file> from a fresh --snapshot'); return 1 }
    const graph = useGraph()
    if (!(await confirm(`Write ${books.length} book pages to ${graph} as author claude?`))) { console.log('Nothing written.'); return 1 }
    const counts = await applyBooks(books, new Grimoire({ author: 'claude' }))
    console.log(`done: ${counts.written} books, ${counts.notes} notes, ${counts.failed.length} failed`)
    for (const f of counts.failed) console.log(`  failed: ${f.name}: ${f.error}`)
    return counts.failed.length ? 1 : 0
  }
  if (!args.includes('--dry-run')) { console.error('usage: pnpm migrate --snapshot <file> | --dry-run [--from <file>] | --apply --from <file>'); return 1 }

  let report = `# Books migration (dry run)\n\n${books.length} books (${byStatus}).\n\n| Page | Status | Author | Rec | Notes | From |\n|---|---|---|---|---|---|\n`
  for (const b of books) report += `| ${b.pageTitle} | ${b.fields.status} | ${b.fields.author ?? ''} | ${b.fields.rec ?? ''} | ${b.notes.length} | ${b.sources[0]} |\n`
  report += `\n## Skipped\n\n${skipped.map((s) => `- ${s.text} (${s.reason})`).join('\n') || 'None.'}\n`
  if (from) {
    useGraph()
    const found = findCollisions(books, [], await existingPages())
    report += `\n## Name collisions\n\nYour pages (not titles yet) that a book would be added to. A page that already has a type (a movie, a person) is never touched; the book goes to "Name (book)" instead and isn't listed here.\n\n${found.map((c) => `- "${c.name}" → existing page "${c.page}" (gets book properties)`).join('\n') || 'None.'}\n`
  }
  writeFileSync(join(repoRoot, 'migration-report.md'), report)
  console.log(`wrote ${join(repoRoot, 'migration-report.md')}`)
  return 0
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c }, (e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
