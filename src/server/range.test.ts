import { parseRange } from './range.ts'

test("'bytes=0-9' of 100 is 0..9", () => expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 }))
test("'bytes=90-' of 100 is 90..99", () => expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 }))
test("'bytes=-10' of 100 is 90..99", () => expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 }))
test('an end past the file is clamped', () => expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 }))
test("'bytes=200-' of 100 is unsatisfiable", () => expect(parseRange('bytes=200-', 100)).toBe('unsatisfiable'))
test('start after end is unsatisfiable', () => expect(parseRange('bytes=9-2', 100)).toBe('unsatisfiable'))
test('no header means the whole file', () => expect(parseRange(undefined, 100)).toBeNull())
test('several ranges are answered with the whole file', () => expect(parseRange('bytes=0-1,5-6', 100)).toBeNull())
test('garbage is answered with the whole file', () => expect(parseRange('lines=1-2', 100)).toBeNull())
