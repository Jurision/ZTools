import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileSearchEngine } from '../../src/main/core/fileSearch/fileSearchEngine'
import { loadEverythingEndpoint } from '../../src/main/core/fileSearch/everythingClient'
import {
  startFakeEverything,
  type FakeEverything,
  type FakeEverythingItem
} from '../helpers/fakeEverything'
let directory: string, fake: FakeEverything, engine: FileSearchEngine
let items: FakeEverythingItem[]
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-index-delta-'))
  items = [{ path: 'E:\\资料\\朱元欣旧稿.txt', modified: Date.now() - 86400000 }]
  fake = await startFakeEverything(items, directory)
  vi.stubEnv('ZTOOLS_EVERYTHING_INI', fake.iniPath)
  engine = new FileSearchEngine()
})
afterEach(async () => {
  engine.dispose()
  await fake.close()
  vi.unstubAllEnvs()
  if (directory.startsWith(path.join(os.tmpdir(), 'ztools-index-delta-')))
    await fs.rm(directory, { recursive: true, force: true })
})

describe('worker engine index refresh lifecycle', () => {
  it('keeps literal matches when the auxiliary Chinese index cannot load', async () => {
    const refresh = vi
      .spyOn(engine, 'refreshIndex')
      .mockRejectedValue(new Error('Chinese index response truncated'))
    const result = await engine.search({ query: '朱元欣', mode: 'fuzzy' })
    expect(result.status).toBe('ok')
    expect(result.items[0]?.name).toBe('朱元欣旧稿.txt')
    refresh.mockRestore()
  })
  it('uses dm/dc overlapping deltas every60s and replaces the index after45minutes', async () => {
    const endpoint = (await loadEverythingEndpoint())!
    const now = Date.now()
    await engine.refreshIndex(endpoint, true, now)
    items.push({ path: 'E:\\资料\\朱元欣新建.txt', created: now + 30000, modified: now - 86400000 })
    items.push({ path: 'E:\\资料\\朱元欣修改.txt', modified: now + 40000 })
    await engine.refreshIndex(endpoint, false, now + 59000)
    expect(fake.searches.filter((query) => query === 'regex:[㐀-鿿]')).toHaveLength(1)
    expect(fake.searches.some((query) => query.includes('dm:'))).toBe(false)
    await engine.refreshIndex(endpoint, false, now + 60000)
    expect(fake.searches.at(-1)).toMatch(/regex:\[㐀-鿿\] <dm:.*\.\.\|dc:.*\.\.>/)
    const response = await engine.search({ query: 'zyx', mode: 'fuzzy' })
    expect(response.items).toHaveLength(3)
    items.splice(0, 1)
    await engine.refreshIndex(endpoint, false, now + 45 * 60000)
    expect(fake.searches.filter((query) => query === 'regex:[㐀-鿿]')).toHaveLength(2)
    expect((await engine.search({ query: 'zyx', mode: 'fuzzy' })).items).toHaveLength(2)
  })
  it('uses only indexed modification dates when creation-date indexing is disabled', async () => {
    const endpoint = { ...(await loadEverythingEndpoint())!, dateCreatedIndexed: false }
    const now = Date.now()
    await engine.refreshIndex(endpoint, true, now)
    items.push({ path: 'E:\\资料\\朱元欣新文件.txt', modified: now + 30000 })
    await engine.refreshIndex(endpoint, false, now + 60000)
    expect(fake.searches.at(-1)).toMatch(/^regex:\[㐀-鿿\] dm:/)
    expect(fake.searches.at(-1)).not.toContain('dc:')
    expect((await engine.search({ query: 'zyx', mode: 'fuzzy' })).items).toHaveLength(2)
  })

  it('does not erase a successful index when refresh loses authentication', async () => {
    const endpoint = (await loadEverythingEndpoint())!
    const now = Date.now()
    await engine.refreshIndex(endpoint, true, now)
    await expect(
      engine.refreshIndex({ ...endpoint, password: 'wrong' }, true, now + 60000)
    ).rejects.toThrow('401')
    expect((await engine.search({ query: 'zyx', mode: 'fuzzy' })).items[0]?.name).toBe(
      '朱元欣旧稿.txt'
    )
  })
})
