import type { Title } from '../../src/shared/title.ts'
import type { TitleDetail } from '../../src/grimoire/grimoire.ts'
import { applyBooks, type MigrationWriter } from './apply.ts'

function fake() {
  const calls: string[] = []
  const notes = new Map<string, { id: string; text: string }[]>()
  const writer: MigrationWriter = {
    async createTitle(input) { calls.push(`create ${input.name} ${input.year ?? ''}`); return { pageId: input.name } as Title },
    async getTitle(id) { return { pageId: id, notes: notes.get(id) ?? [] } as TitleDetail },
    async addNote(id, text) { calls.push(`note ${id} ${text}`); notes.set(id, [...(notes.get(id) ?? []), { id: 'n', text }]); return { id: 'n' } },
  }
  return { writer, calls }
}

test('creates each book by name and year, adds its notes once, and keeps going after a failure', async () => {
  const { writer, calls } = fake()
  const create = writer.createTitle
  writer.createTitle = async (i) => { if (i.name === 'Broken') throw new Error('nope'); return create(i) }
  const counts = await applyBooks([
    { pageTitle: 'Frankenstein (1818)', fields: { status: 'want' }, tags: [], notes: ['a', 'a'], sources: [] },
    { pageTitle: 'Broken', fields: {}, tags: [], notes: [], sources: [] },
    { pageTitle: 'Middlemarch', fields: { status: 'doing' }, tags: [], notes: [], sources: [] },
  ], writer)
  expect(calls).toEqual(['create Frankenstein 1818', 'note Frankenstein a', 'create Middlemarch '])
  expect(counts).toEqual({ written: 2, notes: 1, failed: [{ name: 'Broken', error: 'nope' }] })
})
