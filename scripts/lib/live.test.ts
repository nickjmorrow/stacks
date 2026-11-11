import { findCollisions } from './live.ts'

describe('findCollisions', () => {
  const pages = new Map([
    ['meta', { title: 'Meta', isTitle: false }],
    ['rogue', { title: 'Rogue', isTitle: false }],
    ['coherence (2013)', { title: 'Coherence (2013)', isTitle: true }],
    ['the kitchen', { title: 'The Kitchen', isTitle: false }],
  ])

  test('a new title or a seeded tag landing on an existing non-title page is reported; existing titles are not', () => {
    const found = findCollisions(
      [
        { pageTitle: 'Rogue' },
        { pageTitle: 'Coherence (2013)' },
        { pageTitle: 'The Kitchen (2022)' },
        { pageTitle: 'Akira (1988)' },
        { pageTitle: 'The Kitchen', existingPageId: 'p1' },
      ],
      ['Meta', 'Rainy Day'],
      pages,
    )
    expect(found).toEqual([
      { name: 'Rogue', page: 'Rogue', kind: 'title' },
      { name: 'The Kitchen (2022)', page: 'The Kitchen', kind: 'title' },
      { name: 'Meta', page: 'Meta', kind: 'tag' },
    ])
  })
})
