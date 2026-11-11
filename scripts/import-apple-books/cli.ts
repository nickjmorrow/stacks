// Imports the Apple Books library on the Mac as book title pages in ~/Grimoire (or $GRIMOIRE_GRAPH).
// Run the books-page migration (pnpm migrate) first, so books already listed there are matched, not duplicated.
//   pnpm import-apple-books --dry-run [--db <path>] [--existing <json file of Title[]>]   plan and print counts; writes nothing
//   pnpm import-apple-books [--yes] [--merge-into-existing]                               write as author claude; asks first unless --yes
// A book whose name matches one of the owner's own pages (not a title yet) is listed and skipped, unless
// --merge-into-existing says to add book properties to those pages.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Title } from '../../src/shared/title.ts'
import { defaultLibraryDb, readAppleBooks } from './appleBooks.ts'
import { Grimoire } from '../../src/grimoire/grimoire.ts'
import { confirm, existingPages, findCollisions, useGraph } from '../lib/live.ts'
import { applyImport } from './apply.ts'
import { planImport } from './plan.ts'


function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(args: string[]): Promise<number> {
  const dryRun = args.includes('--dry-run')
  const graph = useGraph()
  const grimoire = new Grimoire({ author: 'claude' })
  const dbPath = flag(args, '--db') ?? defaultLibraryDb()
  const existingPath = flag(args, '--existing')
  const existing: Title[] = existingPath
    ? JSON.parse(readFileSync(resolve(existingPath), 'utf8')) as Title[]
    : await grimoire.listTitles()

  const books = readAppleBooks(resolve(dbPath))
  const plan = planImport(books, existing)

  const byStatus: Record<string, number> = {}
  for (const t of plan.create) {
    const s = t.fields.status ?? '?'
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }
  const reasons: Record<string, number> = {}
  for (const s of plan.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1

  console.log(`books read: ${books.length}`)
  console.log(`create: ${plan.create.length} (${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`)
  console.log(`update: ${plan.update.length}`)
  console.log(`skipped: ${plan.skipped.length}`)
  for (const [reason, n] of Object.entries(reasons)) console.log(`  ${reason}: ${n}`)
  for (const s of plan.skipped) console.log(`  - ${s.title} [${s.assetId}]: ${s.reason}`)
  const odd = plan.create.filter((t) => /[(:]/.test(t.pageTitle))
  if (odd.length > 0) {
    console.log('Check these names:')
    for (const t of odd) console.log(`  - ${t.pageTitle}`)
  }
  const collisions = findCollisions(plan.create, [], await existingPages())
  if (collisions.length > 0) {
    console.log(`Name matches one of your pages (${collisions.length}):`)
    for (const c of collisions) console.log(`  - "${c.name}" → your page "${c.page}"`)
    if (!args.includes('--merge-into-existing')) {
      const skip = new Set(collisions.map((c) => c.name))
      plan.create = plan.create.filter((t) => !skip.has(t.pageTitle))
      console.log('  These are skipped. Re-run with --merge-into-existing to add book properties to those pages.')
    }
  }
  if (dryRun || plan.create.length + plan.update.length === 0) return 0

  if (!args.includes('--yes') && !(await confirm(`Write ${plan.create.length} new and ${plan.update.length} updated books to ${graph} as author claude?`))) {
    console.log('Nothing written.')
    return 1
  }
  const counts = await applyImport(plan, grimoire)
  console.log(`done: ${counts.created} created, ${counts.updated} updated, ${counts.failed.length} failed`)
  for (const f of counts.failed) console.log(`  failed: ${f.name}: ${f.error}`)
  return counts.failed.length > 0 ? 1 : 0
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
