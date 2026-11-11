// A throwaway Grimoire graph for tests, seeded through grim itself. Never touches a real graph.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grim } from './grim.ts'

/** Pages and their Markdown blocks. Tag pages come first so create-page doesn't find them already made. */
const SEED: [title: string, markdown: string][] = [
  ['Slow Burn', '- group:: Vibe'],
  ['Northanger Abbey (2021)', [
    '- tags:: [[media]], [[Read with Alice]]',
    '  type:: book',
    '  status:: want',
    '  rec:: Claude',
    '  apple-books:: tt1160419',
    '  year:: 2021',
    '  runtime:: 155',
    '  genre:: Action, Adventure, Drama',
    '  rt:: 83',
    '  summary:: A young reader of gothic novels visits an old abbey.',
    '- The bath chapters are the funniest part.',
  ].join('\n')],
  ['Bright Harbor (2026)', '- type:: book\n  tags:: [[media]]'],
  ['The Lantern', '- Status:: to-play\n  rating:: TBD\n  type:: book\n  tags:: [[media]]'],
  ['Watchlist', '- tags:: [[list]]\n  type:: book'],
]

/**
 * Create a temp graph with the seed pages and point GRIMOIRE_GRAPH at it.
 * cleanup() deletes it and restores GRIMOIRE_GRAPH.
 */
export async function makeTestGraph(): Promise<{ dir: string; cleanup(): void }> {
  const dir = mkdtempSync(join(tmpdir(), 'grim-test-'))
  const previous = process.env.GRIMOIRE_GRAPH
  process.env.GRIMOIRE_GRAPH = dir
  const cleanup = () => {
    if (previous === undefined) delete process.env.GRIMOIRE_GRAPH
    else process.env.GRIMOIRE_GRAPH = previous
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    for (const [title, markdown] of SEED) {
      await grim(['create-page', title], { author: 'claude' })
      await grim(['append', title, markdown], { author: 'claude' })
    }
  } catch (err) {
    cleanup()
    throw err
  }
  return { dir, cleanup }
}
