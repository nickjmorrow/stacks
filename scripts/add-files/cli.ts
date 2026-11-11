// On the server. Adds staged files to Stacks (its database and books folder), each linked by Apple Books ID to
// the book page the Apple Books import made. Never writes to Grimoire. Same settings as the server.
//   pnpm add-files --manifest <dir>/manifest.json            dry run
//   pnpm add-files --manifest <dir>/manifest.json --apply

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Grimoire } from '../../src/grimoire/grimoire.ts'
import { LOOKUP_TIMEOUT_MS } from '../../src/lookup/lookupError.ts'
import { serverConfig } from '../../src/server/config.ts'
import { Store } from '../../src/store/store.ts'
import type { ManifestEntry } from '../stage-files/stage.ts'
import { addMany } from './addMany.ts'

async function main(args: string[]): Promise<number> {
  const i = args.indexOf('--manifest')
  const manifestPath = i >= 0 ? args[i + 1] : undefined
  if (!manifestPath) {
    console.error('usage: pnpm add-files --manifest <path> [--apply]')
    return 1
  }
  const config = serverConfig(process.env)
  process.env.GRIMOIRE_GRAPH = config.graph
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8')) as ManifestEntry[]
  const store = new Store(config.db)
  try {
    const deps = {
      store, grimoire: new Grimoire({ author: 'claude' }), home: config.home, now: () => Date.now(),
      fetch: (url: string) => fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }),
    }
    const dryRun = !args.includes('--apply')
    const r = await addMany(deps, manifest, dirname(resolve(manifestPath)), { dryRun })
    console.log(`${dryRun ? 'would add' : 'added'} ${r.added}, already there ${r.existing}, no book page ${r.noPage.length}`)
    for (const t of r.noPage) console.log(`  no page: ${t}`)
    return 0
  } finally {
    store.close()
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
