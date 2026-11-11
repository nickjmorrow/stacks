// Shared by the scripts that write to the real Grimoire graph (migration, Apple Books import).

import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { splitPageTitle } from '../../src/shared/titleFormat.ts'
import { grim } from '../../src/grimoire/grim.ts'

/** The graph the scripts work on: $GRIMOIRE_GRAPH, else ~/Grimoire (this Mac's synced copy). */
export function useGraph(): string {
  process.env.GRIMOIRE_GRAPH ||= join(homedir(), 'Grimoire')
  return process.env.GRIMOIRE_GRAPH
}

/** Asks on the terminal; true only for a typed "yes". */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(`${question} Type "yes" to continue: `)).trim() === 'yes'
  } finally {
    rl.close()
  }
}

export interface ExistingPage { title: string; isTitle: boolean }

/** Every page in the graph by lowercase title, marking which are already title pages (tagged media with a type). */
export async function existingPages(): Promise<Map<string, ExistingPage>> {
  const rows = (await grim(['query', `
    select p.title_lower, p.title,
      exists (select 1 from block_props bp join properties pr on pr.id = bp.property_id
              join pages t on t.id = bp.value
              where bp.owner_id in (p.id, (select b.id from blocks b where b.page_id = p.id and b.parent_id is null order by b.order_key limit 1))
                and pr.key = 'tags' and t.title_lower = 'media')
      and exists (select 1 from block_props bp join properties pr on pr.id = bp.property_id
              where bp.owner_id in (p.id, (select b.id from blocks b where b.page_id = p.id and b.parent_id is null order by b.order_key limit 1))
                and pr.key = 'type') as is_title
    from pages p where p.kind = 'page'`])) as { title_lower: string; title: string; is_title: string | number }[]
  return new Map(rows.map((r) => [r.title_lower, { title: r.title, isTitle: String(r.is_title) === '1' }]))
}

export interface Collision { name: string; page: string; kind: 'title' | 'tag' }

/**
 * Planned writes that would land on an existing page that isn't a title: a new title whose page name
 * (or bare name, for "Name (Year)") matches one, or a seeded tag whose page already exists with other content.
 */
export function findCollisions(
  titles: { pageTitle: string; existingPageId?: string }[],
  tags: string[],
  pages: Map<string, ExistingPage>,
): Collision[] {
  const out: Collision[] = []
  for (const t of titles) {
    if (t.existingPageId) continue
    const { name } = splitPageTitle(t.pageTitle)
    const hit = [t.pageTitle, name].map((n) => pages.get(n.toLowerCase())).find((p) => p !== undefined)
    if (hit && !hit.isTitle) out.push({ name: t.pageTitle, page: hit.title, kind: 'title' })
  }
  for (const tag of tags) {
    const hit = pages.get(tag.toLowerCase())
    if (hit && !hit.isTitle) out.push({ name: tag, page: hit.title, kind: 'tag' })
  }
  return out
}
