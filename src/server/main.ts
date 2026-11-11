// Starts the Stacks server: the API on 127.0.0.1 (tailscale serve puts it on the tailnet) and the
// background jobs (Inbox and lookups). Book data lives in the Stacks database (the catalog), not in Grimoire.

import { serve } from '@hono/node-server'
import { Enricher } from '../enrich/enricher.ts'
import type { FilesDeps } from '../files/addFile.ts'
import { scanInbox } from '../files/inbox.ts'
import { Catalog } from '../catalog/catalog.ts'
import { BookEditor } from '../library/editor.ts'
import { OpenLibraryClient } from '../lookup/openLibrary.ts'
import { LOOKUP_TIMEOUT_MS } from '../lookup/lookupError.ts'
import { Store } from '../store/store.ts'
import { createApp } from './app.ts'
import { serverConfig } from './config.ts'

const MINUTE = 60_000

const config = serverConfig(process.env)

const now = () => Date.now()
const fetchFn = (url: string) => fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
const store = new Store(config.db)
const grimoire = new Catalog({ store })
const editor = new BookEditor({ grimoire, store, now })
const lookup = new OpenLibraryClient({ fetch: fetchFn })
const files: FilesDeps = { store, grimoire, home: config.home, fetch: fetchFn, now }
const enricher = new Enricher({ store, grimoire, lookup, files, now })
files.onAdded = (bookId) => enricher.enrichSoon(bookId)

const app = createApp({ grimoire, store, editor, files, enricher, now })
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port })
console.log(`stacks: listening on 127.0.0.1:${config.port}, books in ${config.home}`)

/** Runs a job on an interval, never two at once, logging only runs that did something or failed. */
function every(ms: number, name: string, job: () => Promise<string | null>, firstAfter = ms): NodeJS.Timeout {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const said = await job()
      if (said) console.log(`stacks: ${name}: ${said}`)
    } catch (err) {
      console.error(`stacks: ${name} failed:`, err)
    } finally {
      running = false
    }
  }
  setTimeout(tick, firstAfter)
  return setInterval(tick, ms)
}

const timers = [
  every(MINUTE, 'inbox', async () => {
    const r = await scanInbox(files)
    return r.added || r.failed ? `${r.added} added, ${r.failed} failed` : null
  }),
  every(5 * MINUTE, 'lookups', async () => {
    const r = await enricher.runOnce()
    return r.done || r.needsLook || r.failed ? `${r.done} done, ${r.needsLook} need a look, ${r.failed} failed` : null
  }, 10_000),
  every(MINUTE, 'grimoire retries', async () => {
    const n = await editor.retryOutbox()
    return n ? `${n} written` : null
  }),
]

function shutdown(): void {
  for (const t of timers) clearInterval(t)
  server.close(() => {
    void enricher.idle().finally(() => {
      store.close()
      process.exit(0)
    })
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
