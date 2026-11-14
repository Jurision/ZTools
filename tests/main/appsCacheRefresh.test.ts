import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    store,
    scanApplications: vi.fn(),
    getUwpApps: vi.fn(),
    readPackagedWebAppIdentities: vi.fn(),
    getPackageSnapshot: vi.fn(),
    dbGet: vi.fn((key: string) => store.get(key)),
    dbPut: vi.fn((key: string, value: unknown) => store.set(key, value))
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: {}
}))

vi.mock('../../src/main/core/commandLauncher', () => ({ launchApp: vi.fn() }))
vi.mock('../../src/main/core/commandScanner', () => ({
  scanApplications: mocks.scanApplications
}))
vi.mock('../../src/main/core/native', () => ({
  UwpManager: {
    getUwpApps: mocks.getUwpApps,
    getPackageSnapshot: mocks.getPackageSnapshot
  }
}))
vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: mocks.dbGet, dbPut: mocks.dbPut }
}))
vi.mock('../../src/main/core/commandScanner/packagedWebApps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/core/commandScanner/packagedWebApps')>()),
  readPackagedWebAppIdentities: mocks.readPackagedWebAppIdentities
}))
vi.mock('../../src/main/api/plugin/feature', () => ({ pluginFeatureAPI: {} }))
vi.mock('../../src/main/core/systemSettings/windowsSettings.js', () => ({ WINDOWS_SETTINGS: [] }))
vi.mock('../../src/main/api/renderer/plugins', () => ({ default: {} }))
vi.mock('../../src/main/api/renderer/systemCommands', () => ({ executeSystemCommand: vi.fn() }))
vi.mock('../../src/main/api/renderer/systemSettings', () => ({ systemSettingsAPI: {} }))

import { AppsAPI } from '../../src/main/api/renderer/commands'

describe('AppsAPI 应用缓存刷新', () => {
  beforeEach(() => {
    mocks.store.clear()
    vi.clearAllMocks()
    mocks.getUwpApps.mockReturnValue([])
    mocks.getPackageSnapshot.mockReturnValue([])
    mocks.readPackagedWebAppIdentities.mockResolvedValue([])
  })

  it('rebuilds version 13 app cache once so launch identities are rebuilt', async () => {
    mocks.store.set('cached-commands', [{ name: 'Old App', path: 'C:/Fixture/old.exe' }])
    mocks.store.set('cached-commands-version', 13)
    mocks.store.set('cached-uwp-package-snapshot', [])
    const discovered = [{ name: '百度网盘', path: 'D:/Fixture/BaiduNetdisk.exe' }]
    mocks.scanApplications.mockResolvedValue({ apps: discovered, complete: true, errors: [] })
    const api = new AppsAPI() as unknown as { getApps: () => Promise<unknown[]> }
    expect(await api.getApps()).toEqual(discovered)
    expect(mocks.store.get('cached-commands-version')).toBe(14)
    expect(await api.getApps()).toEqual(discovered)
    expect(mocks.scanApplications).toHaveBeenCalledTimes(1)
  })

  it('keeps the old cache version after failed repair so the next request can retry', async () => {
    const oldApps = [{ name: 'Old App', path: 'C:/Fixture/old.exe' }]
    mocks.store.set('cached-commands', oldApps)
    mocks.store.set('cached-commands-version', 13)
    mocks.store.set('cached-uwp-package-snapshot', [])
    mocks.scanApplications.mockResolvedValue({
      apps: [],
      complete: false,
      errors: ['fixture timeout']
    })
    const api = new AppsAPI() as unknown as { getApps: () => Promise<unknown[]> }
    expect(await api.getApps()).toEqual(oldApps)
    expect(mocks.store.get('cached-commands-version')).toBe(13)
    expect(mocks.dbPut).not.toHaveBeenCalled()
  })

  it('merges packaged aliases on initial scanning and subsequent package refresh', async () => {
    const entries = ['store', 'browser', 'dev'].map((id) => ({
      name: 'Website',
      appId: `${id}!App`,
      icon: 'C:/Fixture/icon.png'
    }))
    mocks.getUwpApps.mockReturnValue(entries)
    mocks.readPackagedWebAppIdentities.mockResolvedValue(
      entries.map((entry, index) => ({
        appId: entry.appId,
        identity: index === 2 ? 'b'.repeat(64) : 'a'.repeat(64),
        store: index === 0
      }))
    )
    mocks.scanApplications.mockResolvedValue({ apps: [], complete: true, errors: [] })
    const api = new AppsAPI() as AppsAPI & { getApps: () => Promise<any[]> }
    const apps = await (api as any).getApps()
    expect(apps.map((x: any) => x.path)).toEqual(['uwp:store!App', 'uwp:dev!App'])
    await api.refreshUwpAppsCache()
    expect((mocks.store.get('cached-commands') as any[]).map((x) => x.path)).toEqual([
      'uwp:store!App',
      'uwp:dev!App'
    ])
    expect(mocks.readPackagedWebAppIdentities).toHaveBeenCalledTimes(2)
  })

  it('Windows 来源扫描不完整时保留旧缓存且不写数据库', async () => {
    const oldApps = [{ name: 'Old App', path: 'C:\\OldApp.lnk' }]
    mocks.store.set('cached-commands', oldApps)
    mocks.store.set('cached-commands-version', 14)
    mocks.scanApplications.mockResolvedValue({
      apps: [{ name: 'Partial App', path: 'C:\\PartialApp.lnk' }],
      complete: false,
      errors: ['flat:C:\\Desktop: scan timed out']
    })
    const api = new AppsAPI() as unknown as {
      scanAndCacheApps: () => Promise<{ apps: unknown[]; cacheUpdated: boolean }>
    }

    const result = await api.scanAndCacheApps()

    expect(result).toEqual({ apps: oldApps, cacheUpdated: false })
    expect(mocks.dbPut).not.toHaveBeenCalled()
    expect(mocks.getUwpApps).not.toHaveBeenCalled()
  })

  it('首次扫描不完整时临时返回部分结果但不持久化', async () => {
    mocks.scanApplications.mockResolvedValue({
      apps: [{ name: 'Partial App', path: 'C:\\PartialApp.lnk' }],
      complete: false,
      errors: ['recursive:C:\\Start Menu: runner exited']
    })
    mocks.getUwpApps.mockReturnValue([
      { name: 'Store App', appId: 'Publisher.StoreApp', icon: 'C:\\StoreApp.png' }
    ])
    const api = new AppsAPI() as unknown as {
      scanAndCacheApps: () => Promise<{ apps: Array<{ path: string }>; cacheUpdated: boolean }>
    }

    const result = await api.scanAndCacheApps()

    expect(result.cacheUpdated).toBe(false)
    expect(result.apps.map((app) => app.path)).toEqual([
      'C:\\PartialApp.lnk',
      'uwp:Publisher.StoreApp'
    ])
    expect(mocks.dbPut).not.toHaveBeenCalled()
  })

  it('独立 UWP 刷新保留 Win32 条目且不调用快捷方式扫描器', async () => {
    mocks.store.set('cached-commands-version', 14)
    mocks.store.set('cached-commands', [
      { name: 'Win32 App', path: 'C:\\Win32App.lnk' },
      { name: 'Old Store App', path: 'uwp:Publisher.OldStoreApp' }
    ])
    mocks.getUwpApps.mockReturnValue([
      { name: 'New Store App', appId: 'Publisher.NewStoreApp', icon: 'C:\\NewStoreApp.png' }
    ])
    mocks.getPackageSnapshot.mockReturnValue(['Publisher.NewStoreApp_2.0.0.0_x64'])
    const api = new AppsAPI()

    await api.refreshUwpAppsCache()

    expect(mocks.scanApplications).not.toHaveBeenCalled()
    expect(mocks.store.get('cached-commands')).toEqual([
      { name: 'Win32 App', path: 'C:\\Win32App.lnk' },
      {
        name: 'New Store App',
        path: 'uwp:Publisher.NewStoreApp',
        icon: expect.stringContaining('ztools-icon://')
      }
    ])
    expect(mocks.store.get('cached-uwp-package-snapshot')).toEqual([
      'Publisher.NewStoreApp_2.0.0.0_x64'
    ])
  })
})
