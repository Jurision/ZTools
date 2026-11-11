import { describe, expect, it, vi } from 'vitest'
import { FileUsageStore, FILE_USAGE_KEY } from '../../src/main/core/fileSearch/fileUsageStore'
import {
  VolumeAvailability,
  isUnavailablePath
} from '../../src/main/core/fileSearch/volumeAvailability'
import { getStorageScopeForKey, isAccountSyncDoc } from '../../src/main/core/storage/storageRouting'
import { createRequire } from 'node:module'
const { includeVolume } = createRequire(import.meta.url)(
  '../../scripts/local/everything-volume-config.cjs'
)

describe('local open history', () => {
  it('counts case-insensitive opens, evicts oldest beyond500, prunes missing and clears onlyhistory', () => {
    let data: unknown = []
    const writes: string[] = []
    const store = new FileUsageStore({
      dbGet: () => data,
      dbPut: (key, value) => {
        writes.push(key)
        data = value
      }
    })
    store.record('C:\\File.txt', true, 1)
    store.record('c:\\file.txt', false, 2)
    expect(store.read()[0]).toMatchObject({ count: 2, lastOpened: 2, indexed: true })
    for (let i = 0; i < 501; i++) store.record(`D:\\${i}.txt`, true, i + 3)
    expect(store.read()).toHaveLength(500)
    expect(store.read().some((row) => row.path.toLowerCase() === 'c:\\file.txt')).toBe(false)
    store.prune(['D:\\500.txt', 'D:\\499.txt'], ['D:\\499.txt'])
    expect(store.read()[0].path).toBe('D:\\499.txt')
    store.remove('d:\\499.txt')
    expect(store.read()[0].path).toBe('D:\\498.txt')
    store.clear()
    expect(store.read()).toEqual([])
    expect(new Set(writes)).toEqual(new Set([FILE_USAGE_KEY]))
    expect(getStorageScopeForKey('ZTOOLS/' + FILE_USAGE_KEY)).toBe('device')
    expect(isAccountSyncDoc('ZTOOLS/' + FILE_USAGE_KEY)).toBe(false)
  })
  it('sanitizes corrupt records and retains the latest case-insensitive duplicate', () => {
    const store = new FileUsageStore({
      dbGet: () => [
        null,
        { path: 'a', count: 0, lastOpened: 1 },
        { path: 'A', count: 2, lastOpened: 3 },
        { path: 'a', count: 4, lastOpened: 5 }
      ],
      dbPut: () => {}
    })
    expect(store.read()).toEqual([{ path: 'a', count: 4, lastOpened: 5, indexed: false }])
  })
})
describe('removable-drive availability without filesystem polling', () => {
  it('rechecks a mount snapshot invalidated while its reader is pending', async () => {
    let finish!: (roots: string[]) => void
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(['C:\\'])
    const volumes = new VolumeAvailability(read)
    const pending = volumes.unavailable()
    volumes.invalidate()
    finish(['C:\\', 'F:\\'])
    expect(isUnavailablePath('F:\\file.txt', await pending)).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('hides unplugged F and detects reconnect after devicechange invalidation', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(['C:\\', 'E:\\', 'F:\\'])
      .mockResolvedValueOnce(['C:\\', 'E:\\'])
      .mockResolvedValueOnce(['C:\\', 'E:\\', 'F:\\'])
    const volumes = new VolumeAvailability(read)
    expect(isUnavailablePath('F:\\照片.jpg', await volumes.unavailable())).toBe(false)
    await volumes.unavailable()
    expect(read).toHaveBeenCalledTimes(1)
    volumes.invalidate()
    expect(isUnavailablePath('F:\\照片.jpg', await volumes.unavailable())).toBe(true)
    expect(isUnavailablePath('E:\\still.txt', await volumes.unavailable())).toBe(false)
    volumes.invalidate()
    expect(isUnavailablePath('F:\\照片.jpg', await volumes.unavailable())).toBe(false)
  })
  it('does not invent all-offline state on an initial OS error', async () => {
    expect(await new VolumeAvailability(async () => null).unavailable()).toEqual([])
  })
})
it('changes only F volume identity/include while preserving other volumes and HTTP settings', () => {
  const original =
    [
      'http_server_password=fixture-only-secret',
      'http_server_bindings=127.0.0.1',
      'auto_include_removable_volumes=0',
      'ntfs_volume_guids="oldC","oldF","oldE"',
      'ntfs_volume_paths="C:","F:","E:"',
      'ntfs_volume_roots="","",""',
      'ntfs_volume_includes=1,0,1',
      'ntfs_volume_load_recent_changes=0,0,0',
      'ntfs_volume_include_onlys="","",""',
      'ntfs_volume_monitors=1,1,1'
    ].join('\r\n') + '\r\n'
  const next = includeVolume(
    original,
    'F:',
    '\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\'
  )
  expect(
    next.replace(/^ntfs_volume_guids=.*$/m, '').replace(/^ntfs_volume_includes=.*$/m, '')
  ).toBe(original.replace(/^ntfs_volume_guids=.*$/m, '').replace(/^ntfs_volume_includes=.*$/m, ''))
  expect(next).toContain('ntfs_volume_includes=1,1,1')
  expect(next).toContain('"oldC"')
  expect(next).toContain('"oldE"')
})
