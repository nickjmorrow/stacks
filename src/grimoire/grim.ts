// The only place that runs the `grim` CLI. Every read and write of Grimoire goes through here.

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export class GrimError extends Error {
  override name = 'GrimError'
}

// Calling convention: pass options as separate tokens, e.g. ['insert', '--page', title, markdown].
// One of these option names followed by a value is sent joined, `--page=<value>`, so a value that
// starts with "-" still reaches the option (grim strips \u0001 only from positional arguments).
// Every other argument after the subcommand is text: if it starts with "-" it is sent with a
// leading \u0001, which grim strips, so it is never read as an option.
const OPTIONS = new Set(['--page', '--parent', '--after', '--since'])

function toArgv(rest: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (OPTIONS.has(a) && i + 1 < rest.length) out.push(`${a}=${rest[++i]}`)
    else out.push(a.startsWith('-') ? `\u0001${a}` : a)
  }
  return out
}

/**
 * Run `grim <subcommand> --graph $GRIMOIRE_GRAPH --json [--author] ...rest` and return its parsed
 * JSON output. args[0] is the subcommand. A non-zero exit, a timeout or unparseable output throws
 * GrimError.
 */
export function grim(args: string[], opts: { author?: 'me' | 'claude' } = {}): Promise<unknown> {
  const graph = process.env.GRIMOIRE_GRAPH
  if (!graph) return Promise.reject(new GrimError('GRIMOIRE_GRAPH is not set'))
  const bin = process.env.GRIM_BIN || join(homedir(), '.local/bin/grim')
  const [subcommand, ...rest] = args
  if (!subcommand) return Promise.reject(new GrimError('grim: no subcommand'))
  const argv = [
    subcommand, '--graph', graph, '--json',
    ...(opts.author ? ['--author', opts.author] : []),
    ...toArgv(rest),
  ]
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { timeout: 30_000, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr.trim().replace(/^Error: /, '')
        const message = err.killed ? `grim ${subcommand} timed out` : detail || `grim ${subcommand} failed: ${err.message}`
        reject(new GrimError(message))
        return
      }
      try {
        resolve(stdout.trim() === '' ? null : JSON.parse(stdout))
      } catch {
        reject(new GrimError(`grim ${subcommand} printed something that is not JSON`))
      }
    })
  })
}
