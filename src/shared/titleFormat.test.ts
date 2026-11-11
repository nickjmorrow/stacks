import { normalizeRating, normalizeStatus, parseProps, parseTagLine, setProp, splitPageTitle, tagLine } from './titleFormat.ts'

describe('setProp', () => {
  test('changes one line and keeps the rest byte-identical', () => {
    const before = 'tags:: [[media]]\nStatus:: to-play\nwhy::  Bloober Team, same devs\n\nyear:: 2021'
    expect(setProp(before, 'status', 'done')).toBe('tags:: [[media]]\nstatus:: done\nwhy::  Bloober Team, same devs\n\nyear:: 2021')
  })

  test('appends a missing key and removes on null', () => {
    expect(setProp('type:: movie', 'rating', '4')).toBe('type:: movie\nrating:: 4')
    expect(setProp('type:: movie\nrating:: 4', 'rating', null)).toBe('type:: movie')
  })

  test('removing a key that is absent changes nothing', () => {
    expect(setProp('type:: movie', 'rating', null)).toBe('type:: movie')
  })

  test('only the first matching line changes when a key repeats', () => {
    expect(setProp('rec:: Kai\nrec:: Theo', 'rec', 'Maya')).toBe('rec:: Maya\nrec:: Theo')
  })

  test('appends to an empty block without a leading newline', () => {
    expect(setProp('', 'type', 'show')).toBe('type:: show')
  })

  test('Windows line endings: reads, edits in place and appends with CRLF', () => {
    const crlf = 'tags:: [[media]]\r\nStatus:: to-play\r\nyear:: 2021'
    expect(parseProps(crlf).get('status')).toBe('to-play')
    expect(setProp(crlf, 'status', 'done')).toBe('tags:: [[media]]\r\nstatus:: done\r\nyear:: 2021')
    expect(setProp(crlf, 'rating', '4')).toBe('tags:: [[media]]\r\nStatus:: to-play\r\nyear:: 2021\r\nrating:: 4')
  })

  test('an indented property line keeps its indent', () => {
    expect(setProp('tags:: [[media]]\n  Status:: want', 'status', 'done')).toBe('tags:: [[media]]\n  status:: done')
  })

  test('a trailing newline does not produce a blank line on append', () => {
    expect(setProp('type:: movie\n', 'rating', '4')).toBe('type:: movie\nrating:: 4')
  })

  test('a space before :: is still the same key', () => {
    expect(setProp('rating :: 4', 'rating', '5')).toBe('rating:: 5')
  })

  test('newlines in a value become spaces so the block keeps its lines', () => {
    expect(setProp('status:: want', 'summary', 'line one\nline two\r\nthree')).toBe('status:: want\nsummary:: line one line two three')
  })

  test('removing a property removes only its own line, not a continuation line', () => {
    expect(setProp('rec:: a\n  continued text\ntype:: movie', 'rec', null)).toBe('  continued text\ntype:: movie')
  })

  test('the group key works on tag pages', () => {
    expect(setProp('', 'group', 'Vibe')).toBe('group:: Vibe')
    expect(setProp('group:: Vibe', 'group', 'Style')).toBe('group:: Style')
  })

  test('does not match a key that only starts the same way', () => {
    expect(setProp('rating-source:: imdb', 'rating', '3')).toBe('rating-source:: imdb\nrating:: 3')
  })
})

describe('parseProps', () => {
  test('lowercases keys, trims values, ignores non-property lines', () => {
    const props = parseProps('Status:: to-play\n  year::  2021 \nsome prose\n\nwhy:: a: b:: c')
    expect(props.get('status')).toBe('to-play')
    expect(props.get('year')).toBe('2021')
    expect(props.get('why')).toBe('a: b:: c')
    expect(props.has('some prose')).toBe(false)
  })

  test('last value wins when a key repeats', () => {
    expect(parseProps('rec:: Kai\nrec:: Theo').get('rec')).toBe('Theo')
  })
})

describe('legacy forms', () => {
  test.each([
    ['to-play', 'want'], ['TODO', 'want'], ['installed', 'want'], ['To Read', 'want'], [undefined, 'want'], ['weird', 'want'],
    ['doing', 'doing'], ['Reading', 'doing'], ['playing', 'doing'],
    ['played', 'done'], ['DONE', 'done'], ['watched', 'done'], ['read', 'done'],
    ['dropped', 'dropped'],
  ] as const)('status %s → %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected)
  })

  test.each([
    ['5', 5], ['5/5', 5], ['4.0', 4], ['3/5', 3], [' 2 ', 2],
  ] as const)('rating %s → %s', (raw, expected) => {
    expect(normalizeRating(raw)).toBe(expected)
  })

  test.each(['TBD', '', undefined, '0', '6', 'great', '4.5'])('rating %s → undefined', (raw) => {
    expect(normalizeRating(raw)).toBeUndefined()
  })
})

describe('splitPageTitle', () => {
  test('strips a trailing year', () => {
    expect(splitPageTitle('Dune (2021)')).toEqual({ name: 'Dune', year: 2021 })
  })
  test('no year', () => {
    expect(splitPageTitle('The Reading Room')).toEqual({ name: 'The Reading Room' })
  })
  test('parentheses that are not a year stay in the name', () => {
    expect(splitPageTitle('Big Brother (season 23)')).toEqual({ name: 'Big Brother (season 23)' })
  })
})

describe('tagLine', () => {
  test('puts media first and drops duplicates of it', () => {
    expect(tagLine(['Slow Burn', 'media', 'Read with Alice'])).toBe('[[media]], [[Slow Burn]], [[Read with Alice]]')
  })
  test('media alone', () => {
    expect(tagLine([])).toBe('[[media]]')
  })
  test('a repeated tag appears once, keeping the first spelling', () => {
    expect(tagLine(['Anime', 'anime', 'Meta'])).toBe('[[media]], [[Anime]], [[Meta]]')
  })
})

describe('parseTagLine', () => {
  test('reads [[links]], #tags and #[[multi word]] tags', () => {
    expect(parseTagLine('[[media]], #Anime, #[[Slow Burn]], [[Read with Alice]]'))
      .toEqual(['media', 'Anime', 'Slow Burn', 'Read with Alice'])
  })
  test('empty', () => {
    expect(parseTagLine('')).toEqual([])
  })
})
