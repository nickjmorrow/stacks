// On the server. One-time move of each book's status, rating, tags, recommended-by and looked-up details from its
// Grimoire page into the Stacks database. Reads Grimoire; writes nothing to it. Re-running is safe.
//   GRIMOIRE_GRAPH=<graph> STACKS_DB=<db> pnpm import-catalog            dry run
//   GRIMOIRE_GRAPH=<graph> STACKS_DB=<db> pnpm import-catalog --apply

import { Grimoire } from '../../src/grimoire/grimoire.ts'
import { serverConfig } from '../../src/server/config.ts'
import { Store } from '../../src/store/store.ts'
import { copyCatalog } from './copy.ts'

async function main(args: string[]): Promise<number> {
  const config = serverConfig(process.env)
  process.env.GRIMOIRE_GRAPH = config.graph
  const store = new Store(config.db)
  const grimoire = new Grimoire({ author: 'claude' })
  const [titles, tags] = await Promise.all([grimoire.listTitles(), grimoire.listTags()])
  const apply = args.includes('--apply')
  const r = copyCatalog(store, titles, tags, { apply })
  console.log(`${apply ? 'copied' : 'would copy'} ${r.copied} books and ${r.groups} tag groups`)
  if (r.missingPage.length) console.log(`${r.missingPage.length} books have no Grimoire page and keep what the catalog already has: ${r.missingPage.join(', ')}`)
  store.close()
  return 0
}

process.exit(await main(process.argv.slice(2)))
