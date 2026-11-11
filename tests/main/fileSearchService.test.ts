import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileSearchService } from '../../src/main/core/fileSearch/fileSearchService'
import { DEFAULT_FILE_SEARCH_EXCLUDES, type FileSearchRequest } from '../../src/shared/fileSearch'
import { FAKE_DISK, startFakeEverything, type FakeEverything } from '../helpers/fakeEverything'

let directory: string
let fake: FakeEverything
let service: FileSearchService
/**
 * Submit the normal UI defaults to the real service against the explicit fake endpoint.
 * @param query Query text.
 * @param overrides Scenario-specific filters and modes.
 * @returns Actual service response.
 */
function search(
  query: string,
  overrides: Partial<FileSearchRequest> = {}
): ReturnType<FileSearchService['search']> {
  return service.search({
    query,
    mode: 'fuzzy',
    types: [],
    sort: 'relevance',
    limit: 50,
    excludes: DEFAULT_FILE_SEARCH_EXCLUDES,
    ...overrides
  })
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-file-search-unit-'))
  fake = await startFakeEverything(FAKE_DISK, directory)
  vi.stubEnv('ZTOOLS_EVERYTHING_INI', fake.iniPath)
  service = new FileSearchService()
})
afterEach(async () => {
  await fake?.close()
  vi.unstubAllEnvs()
  // Only this test-created temporary directory is removed, never an application profile.
  if (directory.startsWith(path.join(os.tmpdir(), 'ztools-file-search-unit-')))
    await fs.rm(directory, { recursive: true, force: true })
})

describe('FileSearchService with authenticated fake Everything', () => {
  it('ranks 家人 literal names before fuzzy insertion and excludes system/cache paths', async () => {
    const result = await search('家人')
    expect(result.status).toBe('ok')
    expect(result.items.slice(0, 2).map((item) => item.name)).toEqual(['家人', '家人'])
    expect(result.items.findIndex((item) => item.name === '家里人.jpg')).toBeGreaterThan(
      result.items.findIndex((item) => item.name.includes('理财达人'))
    )
    expect(result.items.map((item) => item.score)).toEqual(
      [...result.items.map((item) => item.score)].sort((a, b) => a - b)
    )
    expect(result.items.some((item) => /Windows|node_modules/.test(item.path))).toBe(false)
    expect(result.items.find((item) => item.name === '家里人.jpg')?.size).toBe(2048)
  })
  it('retains literal substring matches in exact mode without 家里人', async () => {
    const result = await search('家人', { mode: 'exact' })
    expect(result.status).toBe('ok')
    expect(result.items.some((item) => item.name.includes('理财达人'))).toBe(true)
    expect(result.items.some((item) => item.name === '家里人.jpg')).toBe(false)
  })
  it.each(['zyx', 'zhuyuanxin'])('finds 朱元欣 via pinyin query %s', async (query) => {
    const result = await search(query)
    expect(result.status).toBe('ok')
    expect(result.items[0]?.name).toBe('朱元欣简历.docx')
    expect((await search(query, { mode: 'exact' })).items).toEqual([])
  })
  it('ranks literal 朱元昊 before one-character typo 朱元欣', async () => {
    expect((await search('朱元昊')).items.map((item) => item.name)).toEqual([
      '朱元昊开题报告.docx',
      '朱元欣简历.docx'
    ])
  })
  it('requires every term in the filename, not a term inherited from its parent folder', async () => {
    expect((await search('家人 照片')).items.map((item) => item.name)).toEqual([
      '家人 照片 2020.zip'
    ])
  })
  it('supports re: expressions and rejects invalid regex before contacting the endpoint', async () => {
    const result = await search('re:^朱元[昊欣].*\\.docx$')
    expect(result.status).toBe('ok')
    expect(result.items.map((item) => item.name).sort()).toEqual(
      ['朱元昊开题报告.docx', '朱元欣简历.docx'].sort()
    )
    const count = fake.searches.length
    expect((await search('re:[')).status).toBe('invalid')
    expect(fake.searches).toHaveLength(count)
  })
  it('rejects overlong regex without probing or querying Everything', async () => {
    const response = await search('re:' + 'a'.repeat(255) + '[bc]')
    expect(response).toMatchObject({
      status: 'invalid',
      items: [],
      total: 0,
      message: '正则表达式不能超过 256 个字符'
    })
    expect(fake.searches).toEqual([])
  })

  it('applies type filters to both literal and fuzzy candidates', async () => {
    const folders = await search('家人', { types: ['folder'] })
    expect(folders.items).toHaveLength(3)
    expect(folders.items.every((item) => item.isFolder)).toBe(true)
    expect((await search('家人', { types: ['image'] })).items.map((item) => item.name)).toEqual([
      '家里人.jpg'
    ])
  })
  it('sorts recent results by converted FILETIME and bounds the result count', async () => {
    const result = await search('家人', { sort: 'recent', limit: 3 })
    expect(result.items).toHaveLength(3)
    expect(result.items[0].name).toContain('理财达人')
    expect(result.items[1].name).toBe('家人')
    // Recent sorting preserves the established literal-before-fuzzy grouping.
    const all = await search('家人', { sort: 'recent' })
    expect(all.items.at(-1)?.name).toBe('家里人.jpg')
    expect(result.items.map((item) => item.modified)).toEqual(
      [...result.items.map((item) => item.modified!)].sort((a, b) => b - a)
    )
    expect(result.items[0].modified).toBe(
      FAKE_DISK.find((item) => item.path.endsWith(result.items[0].name))!.modified
    )
  })
  it('deep report search includes insertion and typo variants but ordinary mode does not', async () => {
    const regular = await search('report')
    const deep = await search('report', { deep: true })
    expect(regular.items.map((item) => item.name)).not.toContain('re-port.txt')
    expect(deep.items.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'report.pdf',
        'Annual Report 2024.xlsx',
        're-port.txt',
        'repart-notes.txt'
      ])
    )
    expect(deep.items.findIndex((item) => item.name === 're-port.txt')).toBeLessThan(
      deep.items.findIndex((item) => item.name === 'repart-notes.txt')
    )
  })
  it('returns unavailable for a missing explicit ini without touching the real configuration', async () => {
    vi.stubEnv('ZTOOLS_EVERYTHING_INI', path.join(directory, 'missing.ini'))
    expect((await search('家人')).status).toBe('unavailable')
    expect(fake.searches).toEqual([])
  })
  it('returns unavailable for wrong credentials without exposing them', async () => {
    const badIni = path.join(directory, 'wrong-password.ini')
    await fs.writeFile(
      badIni,
      (await fs.readFile(fake.iniPath, 'latin1')).replace(
        'fixture-only-password',
        'wrong-fixture-password'
      ),
      'latin1'
    )
    vi.stubEnv('ZTOOLS_EVERYTHING_INI', badIni)
    const result = await search('家人')
    expect(result.status).toBe('unavailable')
    expect(JSON.stringify(result)).not.toMatch(/wrong-fixture-password|fixture-only-password/)
  })
  it.each([
    { query: '', status: 'ok' },
    { query: 're:[', status: 'invalid' }
  ])('cancels an in-flight search when new input is $query', async ({ query, status }) => {
    const old = search('家人', { channel: 'main' })
    const replacement = search(query, { channel: 'main' })
    const [oldResult, replacementResult] = await Promise.all([old, replacement])
    expect(oldResult.status).toBe('cancelled')
    expect(replacementResult).toMatchObject({ status, items: [], total: 0 })
  })

  it('cancels a superseded request on the same channel during the connection probe', async () => {
    const old = search('家人', { channel: 'main' })
    const current = search('朱元欣', { channel: 'main' })
    const [oldResult, currentResult] = await Promise.all([old, current])
    expect(oldResult.status).toBe('cancelled')
    expect(currentResult.items[0]?.name).toBe('朱元欣简历.docx')
  })
})
