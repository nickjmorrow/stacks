// Turns the owner's notes pages listed in a local JSON file into their books' pages, and gives the
// books listed under `separate` their own book pages. Run after `pnpm import-apple-books`.
//   pnpm merge-pages --config <lists.json>            dry run: prints what each page gets; writes nothing
//   pnpm merge-pages --config <lists.json> --apply    writes as author claude, after a typed "yes"
// lists.json: { "merges": ["Page Name", …], "separate": [{ "page": "Name (1990)", "match": "Name", "year": 1990 }, …] }

import { readFileSync } from 'node:fs'
import { Grimoire } from '../../src/grimoire/grimoire.ts'
import { defaultLibraryDb, readAppleBooks } from '../import-apple-books/appleBooks.ts'
import { confirm, existingPages, useGraph } from '../lib/live.ts'
import { planMerges, type MergeLists } from './plan.ts'

async function main(args: string[]): Promise<number> {
  const i = args.indexOf('--config')
  const config = i >= 0 ? args[i + 1] : undefined
  if (!config) { console.error('usage: pnpm merge-pages --config <lists.json> [--apply]'); return 1 }
  const lists = JSON.parse(readFileSync(config, 'utf8')) as MergeLists
  const graph = useGraph()
  const { plans, missing, skipped } = planMerges(readAppleBooks(defaultLibraryDb()), await existingPages(), lists)
  for (const p of plans) {
    const lines = Object.entries(p.fields).map(([k, v]) => `${k}:: ${v}`).join(', ')
    console.log(`${p.action === 'merge' ? 'merge into' : 'new page  '} "${p.page}": [[media]], type:: book, ${lines}`)
  }
  for (const m of missing) console.log(`not found: ${m}`)
  for (const m of skipped) console.log(`skipped: ${m}`)
  if (!args.includes('--apply') || plans.length === 0) return 0
  if (!(await confirm(`Write these ${plans.length} pages in ${graph} as author claude?`))) {
    console.log('Nothing written.')
    return 1
  }
  const grimoire = new Grimoire({ author: 'claude' })
  for (const p of plans) {
    const t = await grimoire.createTitle({ name: p.page, type: 'book', fields: p.fields, tags: [] })
    console.log(`done: ${t.pageTitle}`)
  }
  return 0
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
