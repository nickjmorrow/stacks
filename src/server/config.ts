// The server's settings from the environment, checked before anything starts. The Grimoire graph is only
// read by `pnpm import-catalog`; the server doesn't use it.

import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_PORT = 8782

export interface ServerConfig { port: number; graph: string; home: string; db: string }

function expand(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

/** Throws with a message naming the variable when a setting is missing or invalid. */
export function serverConfig(env: Record<string, string | undefined>): ServerConfig {
  const raw = env.PORT?.trim() ?? ''
  const port = raw === '' ? DEFAULT_PORT : /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!(port >= 1 && port <= 65535)) throw new Error(`PORT must be a whole number from 1 to 65535, got ${JSON.stringify(env.PORT)}`)
  return {
    port,
    graph: expand(env.GRIMOIRE_GRAPH?.trim() || '~/Grimoire'),
    home: expand(env.STACKS_HOME?.trim() || '~/Stacks'),
    db: expand(env.STACKS_DB?.trim() || '~/Library/Application Support/stacks/stacks.db'),
  }
}
