import { expect, test } from 'vitest'
import { Store } from '../store/store.ts'
import { Catalog } from './catalog.ts'

function setup() {
  const store = new Store(':memory:')
  let t = 1000
  return { store, catalog: new Catalog({ store, now: () => ++t }) }
}

test('a created book starts as want with its fields, and a second create returns the same book', async () => {
  const { catalog } = setup()
  const dune = await catalog.createTitle({ name: 'Dune', type: 'book', fields: { author: 'Frank Herbert', 'apple-books': 'A1' }, tags: [] })
  expect(dune).toMatchObject({ pageTitle: 'Dune', status: 'want', author: 'Frank Herbert', appleBooks: 'A1' })
  expect((await catalog.createTitle({ name: 'dune', type: 'book', fields: {}, tags: [] })).pageId).toBe(dune.pageId)
  expect(await catalog.pageKind('DUNE')).toBe('book')
  expect(await catalog.pageKind('Emma')).toBe('none')
})

test('setFields changes, clears and guards by status', async () => {
  const { catalog } = setup()
  const b = await catalog.createTitle({ name: 'Emma', type: 'book', fields: {}, tags: [] })
  expect((await catalog.setFields(b.pageId, { status: 'doing', rating: '4', rec: 'Ines' })).rating).toBe(4)
  expect((await catalog.setFields(b.pageId, { status: 'done' }, { onlyIfStatus: ['want'] })).status).toBe('doing')
  const cleared = await catalog.setFields(b.pageId, { rating: null, rec: null })
  expect(cleared.rating).toBeUndefined()
  expect(cleared.rec).toBeUndefined()
  expect((await catalog.getTitle(b.pageId))?.status).toBe('doing')
})

test('tags are saved in order, counted, and keep their groups', async () => {
  const { catalog } = setup()
  const a = await catalog.createTitle({ name: 'A', type: 'book', fields: {}, tags: [] })
  const b = await catalog.createTitle({ name: 'B', type: 'book', fields: {}, tags: [] })
  await catalog.setTags(a.pageId, ['scifi', 'cozy'])
  await catalog.setTags(b.pageId, ['scifi'])
  await catalog.setTagGroup('scifi', 'Style')
  expect((await catalog.getTitle(a.pageId))?.tags).toEqual(['scifi', 'cozy'])
  expect(await catalog.listTags()).toEqual([{ title: 'cozy', count: 1 }, { title: 'scifi', group: 'Style', count: 2 }])
})

test('editing an unknown page is a not-found error', async () => {
  const { catalog } = setup()
  await expect(catalog.setFields('nope', { status: 'doing' })).rejects.toThrow()
})
