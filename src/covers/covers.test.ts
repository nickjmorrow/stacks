import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG_1PX } from '../../test/fixtures/makeEpub.ts'
import { fetchOpenLibraryCover, saveCover } from './covers.ts'

test('saveCover writes a JPEG 600 px tall', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stacks-cover-'))
  try {
    const out = join(dir, 'covers', 'b1.jpg')
    await saveCover(new Uint8Array(PNG_1PX), out)
    expect(existsSync(out)).toBe(true)
    const info = execFileSync('sips', ['-g', 'pixelHeight', '-g', 'format', out]).toString()
    expect(info).toMatch(/pixelHeight: 600/)
    expect(info).toMatch(/format: jpeg/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fetchOpenLibraryCover asks for the large cover by ISBN and returns its bytes', async () => {
  const urls: string[] = []
  const bytes = await fetchOpenLibraryCover('9780441013593', async (url) => {
    urls.push(url)
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
  })
  expect(urls).toEqual(['https://covers.openlibrary.org/b/isbn/9780441013593-L.jpg?default=false'])
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
})

test('fetchOpenLibraryCover returns null on 404', async () => {
  expect(await fetchOpenLibraryCover('9780441013593', async () => new Response('', { status: 404 }))).toBeNull()
})

test('fetchOpenLibraryCover returns null when the network fails', async () => {
  expect(await fetchOpenLibraryCover('9780441013593', async () => { throw new Error('offline') })).toBeNull()
})
