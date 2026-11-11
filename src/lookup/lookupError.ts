/** Transient trouble talking to a lookup service: try again later, write nothing. */
export class LookupUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LookupUnavailableError'
  }
}

export type FetchLike = (url: string) => Promise<Response>

export const LOOKUP_TIMEOUT_MS = 10_000

/** GET a URL and parse JSON, turning network, timeout and parse failures into LookupUnavailableError. */
export async function getJson(
  fetchFn: FetchLike,
  url: string,
  service: string,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  const work = (async () => {
    const res = await fetchFn(url)
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // Non-JSON body: only a problem when the status is also bad.
    }
    return { ok: res.ok, status: res.status, body }
  })()
  work.catch(() => {}) // a late failure after the timeout must not be unhandled
  try {
    return await Promise.race([work, timeout])
  } catch (e) {
    throw new LookupUnavailableError(`${service} unreachable: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(timer)
  }
}
