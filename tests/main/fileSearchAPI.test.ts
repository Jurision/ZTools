import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  offline: [] as string[],
  stat: vi.fn(),
  open: vi.fn(),
  reveal: vi.fn(),
  search: vi.fn(),
  remove: vi.fn(),
  existing: vi.fn(),
  volumes: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: mocks.open, showItemInFolder: mocks.reveal }
}))
vi.mock('node:fs/promises', () => ({ default: { stat: mocks.stat } }))
vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: (key: string) => mocks.data.get(key),
    dbPut: (key: string, value: unknown) => mocks.data.set(key, value)
  }
}))
vi.mock('../../src/main/core/backgroundTestMode', () => ({ isBackgroundTest: () => false }))
vi.mock('../../src/main/core/fileSearch/fileSearchService', () => ({
  default: {
    search: mocks.search,
    removePath: mocks.remove,
    existingPaths: mocks.existing,
    warmUp: vi.fn()
  }
}))
vi.mock('../../src/main/core/fileSearch/volumeAvailability', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/main/core/fileSearch/volumeAvailability')>()
  return {
    ...original,
    VolumeAvailability: class {
      invalidate(): void {}
      async unavailable(): Promise<string[]> {
        return mocks.volumes()
      }
    }
  }
})
import { FileSearchAPI, fileUsageStore } from '../../src/main/api/renderer/fileSearch'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.data.clear()
  mocks.offline = []
  mocks.volumes.mockImplementation(async () => mocks.offline)
  mocks.stat.mockResolvedValue({ isDirectory: () => false, size: 12, mtimeMs: 123 })
  mocks.open.mockResolvedValue('')
  mocks.search.mockResolvedValue({ status: 'ok', items: [], total: 0 })
  mocks.existing.mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())
describe('file result actions with fake filesystem and database', () => {
  it('resolves existing unquoted paths with spaces without changing the index query', async () => {
    const query = 'D:\\Family Photos\\my note.txt'
    const result = await (new FileSearchAPI() as any).search({ query })
    expect(mocks.stat).toHaveBeenCalledWith(query)
    expect(result.items[0].path).toBe(query)
    expect(mocks.search.mock.calls[0][0].query).toBe(query)
  })
  it('retains descendant matches when path plus filename is not an existing literal path', async () => {
    const query = 'D:\\APP\\Aurora\\Aurora mods.txt'
    const target = 'D:\\APP\\Aurora\\Aurora\\Bin\\nte\\Lua\\ue4ss\\Mods\\mods.txt'
    mocks.stat.mockRejectedValue({ code: 'ENOENT' })
    mocks.search.mockResolvedValue({ status: 'ok', items: [{ path: target }], total: 1 })
    const result = await (new FileSearchAPI() as any).search({ query })
    expect(result.items.map((item: { path: string }) => item.path)).toEqual([target])
    expect(mocks.search.mock.calls[0][0].query).toBe(query)
  })
  it('keeps history if a drive disconnects while index validation is pending', async () => {
    let finish!: (paths: string[]) => void
    mocks.existing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    fileUsageStore.record('F:\\kept.txt', true)
    const api = new FileSearchAPI() as any
    api.pruneHistory([])
    expect(mocks.existing).toHaveBeenCalledTimes(1)
    mocks.offline = ['f:\\']
    finish([])
    await vi.waitFor(() => expect(mocks.volumes).toHaveBeenCalled())
    expect(fileUsageStore.read()).toHaveLength(1)
  })
  it('never stats a path escaping the isolated test root', async () => {
    vi.stubEnv('ZTOOLS_E2E', '1')
    vi.stubEnv('ZTOOLS_DATA_ROOT', 'C:\\isolated-root')
    await (new FileSearchAPI() as any).search({ query: 'C:\\isolated-root\\..\\outside.txt' })
    expect(mocks.stat).not.toHaveBeenCalled()
  })
  it('does not dispatch an obsolete query after a slow mount lookup', async () => {
    let finish!: (roots: string[]) => void
    mocks.volumes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const api = new FileSearchAPI() as any
    const old = api.search({ query: 'old', channel: 'main' })
    await api.search({ query: 'new', channel: 'main' })
    finish([])
    expect((await old).status).toBe('cancelled')
    expect(mocks.search).toHaveBeenCalledTimes(1)
    expect(mocks.search.mock.calls[0][0].query).toBe('new')
  })
  it('discards an obsolete direct path even when its stat fails late', async () => {
    let fail!: (error: unknown) => void
    mocks.stat.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        })
    )
    const api = new FileSearchAPI() as any
    const old = api.search({ query: 'C:\\fixture\\old.txt', channel: 'main' })
    await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(1))
    await api.search({ query: 'new', channel: 'main' })
    fail({ code: 'ENOENT' })
    expect((await old).status).toBe('cancelled')
  })
  it('records only successful opens and reveals, never failed shell launches', async () => {
    const api = new FileSearchAPI() as any
    expect(await api.open('C:\\fixture\\a.txt', false)).toEqual({ success: true })
    expect(await api.open('C:\\fixture\\a.txt', true)).toEqual({ success: true })
    expect(fileUsageStore.read()[0].count).toBe(2)
    mocks.open.mockResolvedValue('Launch failed')
    expect((await api.open('C:\\fixture\\bad.txt', false)).success).toBe(false)
    expect(fileUsageStore.read()).toHaveLength(1)
  })
  it('drops confirmed missing targets from history and fuzzy index', async () => {
    fileUsageStore.record('C:\\fixture\\gone.txt')
    mocks.stat.mockRejectedValue({ code: 'ENOENT' })
    expect((await (new FileSearchAPI() as any).open('C:\\fixture\\gone.txt', false)).success).toBe(
      false
    )
    expect(fileUsageStore.read()).toEqual([])
    expect(mocks.remove).toHaveBeenCalledWith('C:\\fixture\\gone.txt')
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('blocks offline-drive actions before any stat or shell invocation', async () => {
    mocks.offline = ['f:\\']
    expect(await (new FileSearchAPI() as any).open('F:\\a.txt', false)).toMatchObject({
      success: false,
      error: expect.stringContaining('盘不在')
    })
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('puts an explicit existing quoted path first and overrides renderer-supplied history', async () => {
    const result = await (new FileSearchAPI() as any).search({
      query: '"C:\\Fixture Space\\a.txt"',
      limit: 5,
      history: { fake: { count: 999 } },
      unavailableRoots: ['c:\\']
    })
    expect(result.items[0].path).toBe('C:\\Fixture Space\\a.txt')
    expect(mocks.search.mock.calls[0][0]).toMatchObject({ history: {}, unavailableRoots: [] })
  })
  it('does not probe an offline direct path or an ordinary path fragment', async () => {
    mocks.offline = ['f:\\']
    const api = new FileSearchAPI() as any
    await api.search({ query: '"F:\\Folder Space"' })
    await api.search({ query: 'Family\\ jpg' })
    expect(mocks.stat).not.toHaveBeenCalled()
  })
})
