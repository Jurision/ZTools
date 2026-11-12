import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import type { FileSearchResponse } from '../../src/shared/fileSearch'

const mocks = vi.hoisted(() => ({ cleanup: [] as (() => void)[], store: {} as any }))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onUnmounted: (cleanup: () => void) => mocks.cleanup.push(cleanup)
}))
vi.mock('../../src/renderer/src/stores/windowStore', () => ({ useWindowStore: () => mocks.store }))
import { useFileSearch } from '../../src/renderer/src/composables/useFileSearch'

let scope: EffectScope
let search: ReturnType<typeof vi.fn>
let unsubscribe: ReturnType<typeof vi.fn>
/**
 * Build one synthetic file response without consulting the real disk index.
 * @param name Fixture file name.
 * @returns A successful one-row response.
 */
const answer = (name: string): FileSearchResponse => ({
  status: 'ok',
  total: 1,
  items: [{ name, path: 'D:/' + name, dir: 'D:/', isFolder: false, score: 0 }]
})

beforeEach(() => {
  vi.useFakeTimers()
  mocks.store = reactive({
    fileSearch: { excludes: ['private'] },
    fileSearchView: { mode: 'exact', types: ['document'], sort: 'size', direction: 'desc' }
  })
  search = vi.fn(async () => answer('found.txt'))
  unsubscribe = vi.fn()
  vi.stubGlobal('window', {
    ztools: { searchFiles: search, onFileSearchRefresh: () => unsubscribe }
  })
  scope = effectScope()
})
afterEach(() => {
  mocks.cleanup.splice(0).forEach((cleanup) => cleanup())
  scope.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('inline file preview request lifetime', () => {
  it('debounces typing and keeps main previews independent of detailed-page filters', async () => {
    const query = ref('first')
    const state = scope.run(() =>
      useFileSearch({ query: () => query.value, limit: 6, channel: 'main', debounceMs: 250 })
    )!
    await vi.advanceTimersByTimeAsync(200)
    expect(search).not.toHaveBeenCalled()
    query.value = 'final'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    expect(search).toHaveBeenCalledTimes(2)
    expect(search.mock.calls[0][0]).toMatchObject({
      query: 'final',
      types: [],
      mode: 'fuzzy',
      sort: 'relevance',
      direction: 'asc',
      limit: 6,
      excludes: ['private']
    })
    expect(search.mock.calls[1][0].phase).toBe('fuzzy')
    expect(state.items.value[0].name).toBe('found.txt')
    mocks.store.fileSearchView = { mode: 'exact', types: ['video'], sort: 'name' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(search).toHaveBeenCalledTimes(2)
  })
  it('still honors dedicated-page filtering and ordering', async () => {
    scope.run(() => useFileSearch({ query: () => 'paper', limit: 200, channel: 'page' }))
    await vi.advanceTimersByTimeAsync(150)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0][0]).toMatchObject({
      types: ['document'],
      mode: 'exact',
      sort: 'size',
      direction: 'desc'
    })
  })
  it('shows literal matches while fuzzy work is pending and discards late fuzzy results', async () => {
    let resolve!: (response: FileSearchResponse) => void
    search.mockResolvedValueOnce(answer('literal.txt'))
    search.mockImplementationOnce(
      () =>
        new Promise<FileSearchResponse>((done) => {
          resolve = done
        })
    )
    const query = ref('text')
    const state = scope.run(() =>
      useFileSearch({ query: () => query.value, limit: 6, channel: 'main' })
    )!
    await vi.advanceTimersByTimeAsync(150)
    expect(state.items.value[0].name).toBe('literal.txt')
    expect(state.loading.value).toBe(true)
    query.value = ''
    await nextTick()
    resolve(answer('late-fuzzy.txt'))
    await nextTick()
    expect(state.items.value).toEqual([])
    expect(state.loading.value).toBe(false)
  })
  it('discards an old response even during the next query debounce interval', async () => {
    let resolve!: (response: FileSearchResponse) => void
    search.mockImplementationOnce(
      () =>
        new Promise<FileSearchResponse>((done) => {
          resolve = done
        })
    )
    const query = ref('old')
    const state = scope.run(() =>
      useFileSearch({ query: () => query.value, limit: 6, channel: 'main' })
    )!
    await vi.advanceTimersByTimeAsync(150)
    query.value = 'new'
    await nextTick()
    resolve(answer('obsolete.txt'))
    await nextTick()
    expect(state.items.value).toEqual([])
    await vi.advanceTimersByTimeAsync(150)
    expect(state.items.value[0].name).toBe('found.txt')
    expect(search.mock.calls.map(([request]) => request.query)).toEqual(['old', 'new', 'new'])
  })
  it('clears results immediately when the query is disabled or emptied', async () => {
    const query = ref('text')
    const state = scope.run(() =>
      useFileSearch({ query: () => query.value, limit: 6, channel: 'main' })
    )!
    await vi.advanceTimersByTimeAsync(150)
    expect(state.items.value).toHaveLength(1)
    query.value = ''
    await nextTick()
    expect(state.items.value).toEqual([])
    expect(state.loading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    expect(search).toHaveBeenCalledTimes(2)
  })
  it('contains IPC failures in the preview instead of failing app search', async () => {
    search.mockRejectedValue(new Error('index unavailable'))
    const state = scope.run(() =>
      useFileSearch({ query: () => 'text', limit: 6, channel: 'main' })
    )!
    await vi.advanceTimersByTimeAsync(150)
    expect(state.status.value).toBe('unavailable')
    expect(state.loading.value).toBe(false)
    expect(state.items.value).toEqual([])
  })
  it('removes pending timers and ignores replies when leaving the main search view', async () => {
    let resolve!: (response: FileSearchResponse) => void
    search.mockImplementationOnce(
      () =>
        new Promise<FileSearchResponse>((done) => {
          resolve = done
        })
    )
    const state = scope.run(() =>
      useFileSearch({ query: () => 'text', limit: 6, channel: 'main' })
    )!
    await vi.advanceTimersByTimeAsync(150)
    mocks.cleanup.splice(0).forEach((cleanup) => cleanup())
    scope.stop()
    resolve(answer('obsolete.txt'))
    await nextTick()
    expect(state.items.value).toEqual([])
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledTimes(1)
  })
})
