import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  parseEverythingIni,
  resolveEverythingIniPath,
  loadEverythingEndpoint,
  queryEverything,
  startEverythingInBackground
} from '../../src/main/core/fileSearch/everythingClient'
import { startFakeEverything, FAKE_DISK, type FakeEverything } from '../helpers/fakeEverything'
const validIni =
  '[Everything]\r\nhttp_server_enabled=1\r\nhttp_server_port=12345\r\nhttp_server_username=fixture-user\r\nhttp_server_password=fixture=pass\r\n'
describe('Everything ini parsing and isolation', () => {
  it('parses CRLF values and preserves equals signs in the password', () => {
    expect(parseEverythingIni(validIni)).toEqual({
      port: 12345,
      username: 'fixture-user',
      password: 'fixture=pass'
    })
  })
  it('allows creation-date deltas only when the ini explicitly indexes creation dates', () => {
    expect(parseEverythingIni(validIni)?.dateCreatedIndexed).toBeUndefined()
    expect(
      parseEverythingIni(validIni + 'index_date_created=0\r\n')?.dateCreatedIndexed
    ).toBeUndefined()
    expect(parseEverythingIni(validIni + 'index_date_created=1\r\n')?.dateCreatedIndexed).toBe(true)
  })
  it.each(['0', '-1', '65536', '1.5', 'abc', ''])('rejects invalid port %s', (port) => {
    expect(parseEverythingIni(validIni.replace('12345', port))).toBeNull()
  })
  it('rejects switched-off or disallowed HTTP while allowing implicit allow_http_server', () => {
    expect(parseEverythingIni(validIni.replace('enabled=1', 'enabled=0'))).toBeNull()
    expect(parseEverythingIni(validIni + 'allow_http_server=0\r\n')).toBeNull()
    expect(parseEverythingIni(validIni)).not.toBeNull()
  })
  it.each([{ ZTOOLS_E2E: '1' }, { ZTOOLS_BACKGROUND_TEST: '1' }, { VITEST: 'true' }])(
    'requires explicit fixture path under test flag %o',
    (flags) => {
      expect(
        resolveEverythingIniPath({ ...flags, APPDATA: 'C:/must-not-read-real-appdata' })
      ).toBeNull()
      expect(
        resolveEverythingIniPath({ ...flags, ZTOOLS_EVERYTHING_INI: 'C:/fixture/Everything.ini' })
      ).toBe('C:/fixture/Everything.ini')
    }
  )
  it('only computes the production path without reading it', () => {
    expect(resolveEverythingIniPath({ APPDATA: 'C:/fixture-appdata' })).toBe(
      process.platform === 'win32'
        ? path.join('C:/fixture-appdata', 'Everything', 'Everything.ini')
        : null
    )
    expect(resolveEverythingIniPath({})).toBeNull()
  })
})
let directory: string
let fake: FakeEverything
describe('Everything HTTP client using explicit fake ini only', () => {
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-everything-client-unit-'))
    fake = await startFakeEverything(FAKE_DISK, directory)
    vi.stubEnv('ZTOOLS_EVERYTHING_INI', fake.iniPath)
  })
  afterEach(async () => {
    await fake?.close()
    vi.unstubAllEnvs()
    if (directory.startsWith(path.join(os.tmpdir(), 'ztools-everything-client-unit-')))
      await fs.rm(directory, { recursive: true, force: true })
  })
  it('loads only the fixture and converts names, parent folders, sizes and FILETIME', async () => {
    const endpoint = await loadEverythingEndpoint()
    expect(endpoint?.port).toBe(fake.port)
    const result = await queryEverything(endpoint!, {
      search: 'wfn:"家里人.jpg"',
      count: 2,
      recentFirst: true
    })
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({
      name: '家里人.jpg',
      dir: 'E:\\照片',
      size: 2048,
      isFolder: false,
      modified: FAKE_DISK.find((item) => item.path.endsWith('家里人.jpg'))!.modified
    })
    expect(startEverythingInBackground()).toBe(false)
  })
  it('rejects authentication failure instead of silently reporting no matches', async () => {
    const endpoint = await loadEverythingEndpoint()
    await expect(
      queryEverything(
        { ...endpoint!, password: 'wrong' },
        { search: '家人', count: 5, recentFirst: false }
      )
    ).rejects.toThrow('Everything HTTP 401')
  })
  it('honors an already-aborted request without querying any index', async () => {
    const endpoint = await loadEverythingEndpoint()
    const abort = new AbortController()
    abort.abort()
    await expect(
      queryEverything(endpoint!, { search: '家人', count: 5, recentFirst: false }, abort.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.searches).toEqual([])
  })
})
