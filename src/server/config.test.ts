import { homedir } from 'node:os'
import { join } from 'node:path'
import { serverConfig } from './config.ts'

test('a missing GRIMOIRE_GRAPH is fine: the server no longer reads Grimoire', () => {
  expect(serverConfig({}).graph).toBe(join(homedir(), 'Grimoire'))
})

test("PORT 'abc' throws naming it", () => {
  expect(() => serverConfig({ GRIMOIRE_GRAPH: '/g', PORT: 'abc' })).toThrow(/PORT/)
})

test('defaults, with ~ expanded', () => {
  expect(serverConfig({ GRIMOIRE_GRAPH: '~/Notes' })).toEqual({
    port: 8782,
    graph: join(homedir(), 'Notes'),
    home: join(homedir(), 'Stacks'),
    db: join(homedir(), 'Library', 'Application Support', 'stacks', 'stacks.db'),
  })
})

test('settings from the environment', () => {
  expect(serverConfig({ GRIMOIRE_GRAPH: '/g', PORT: '9000', STACKS_HOME: '/books', STACKS_DB: '/db/s.db' }))
    .toEqual({ port: 9000, graph: '/g', home: '/books', db: '/db/s.db' })
})
