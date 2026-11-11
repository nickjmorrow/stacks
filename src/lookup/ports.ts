import type { FieldKey, MediaType } from '../shared/title.ts'

export interface LookupResult { source: 'openlibrary'; id: string; name: string; year?: number; detail: string }
export interface Lookup {
  search(type: MediaType, q: string): Promise<LookupResult[]>
  details(type: MediaType, id: string): Promise<Partial<Record<FieldKey, string>>>
}
