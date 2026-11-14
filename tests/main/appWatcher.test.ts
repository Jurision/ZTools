import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

// chokidar 的 mock watcher：记录 on 注册的回调，并提供 __emit 触发事件
type MockWatcherApi = {
  on: Mock
  close: Mock
  __emit: (event: string, ...args: unknown[]) => void
}
const { createMockWatcher } = vi.hoisted(() => {
  const createMockWatcher = (): MockWatcherApi => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    const api: MockWatcherApi = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        ;(handlers[event] ||= []).push(cb)
        return api
      }),
      close: vi.fn(),
      __emit: (event: string, ...args: unknown[]) => {
        for (const cb of handlers[event] || []) cb(...args)
      }
    }
    return api
  }
  return { createMockWatcher }
})

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => createMockWatcher()) }
}))

// appWatcher 用 BrowserWindow（类型）；systemPaths 用 app.getPath —— 一并 mock
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: { getPath: vi.fn((name: string) => `/mock/${name}`) }
}))

// notifyChange -> appsAPI.refreshAppsCache；mock 避免加载重量级 commands.ts（LMDB 等依赖）
vi.mock('../../src/main/api/renderer/commands', () => ({
  default: {
    refreshAppsCache: vi.fn(),
    haveInstalledRegistrationsChanged: vi.fn(),
    refreshUwpAppsCache: vi.fn(),
    refreshAppsCacheIfUwpPackagesChanged: vi.fn()
  }
}))

const uwpMonitorMock = vi.hoisted(() => {
  let callback: ((event: { type: string; packageFullName: string }) => void) | null = null
  return {
    start: vi.fn((nextCallback: typeof callback) => {
      callback = nextCallback
    }),
    stop: vi.fn(),
    emit: (event: { type: string; packageFullName: string }) => callback?.(event),
    reset: () => {
      callback = null
    }
  }
})

vi.mock('../../src/main/core/uwpPackageMonitor', () => ({
  startUwpPackageMonitor: uwpMonitorMock.start,
  stopUwpPackageMonitor: uwpMonitorMock.stop
}))

import chokidar from 'chokidar'
import path from 'path'
import appsAPI from '../../src/main/api/renderer/commands'
import {
  getWindowsFlatScanPaths,
  getWindowsRecursiveScanPaths
} from '../../src/main/utils/systemPaths'
import appWatcher from '../../src/main/appWatcher'

let originalPlatform: string
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(appsAPI.refreshAppsCache).mockReset().mockResolvedValue(true)
  vi.mocked(appsAPI.refreshUwpAppsCache).mockReset().mockResolvedValue(true)
  vi.mocked(appsAPI.haveInstalledRegistrationsChanged).mockReset().mockResolvedValue(false)
  uwpMonitorMock.reset()
  originalPlatform = process.platform
  // stub 为 win32：使 getRecursiveWatchPaths / getFlatRootWatchPaths 返回 Windows 路径，
  // 从而同时创建递归 watcher 与扁平根 watcher
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  vi.useFakeTimers()
})
afterEach(() => {
  appWatcher.stop()
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

describe('AppWatcher 双 watcher 接线', () => {
  it('checks installation registrations without full scans when unchanged; discovers registry-only installs', async () => {
    appWatcher.init({} as never)
    await vi.advanceTimersByTimeAsync(300001)
    expect(appsAPI.refreshAppsCache).not.toHaveBeenCalled()
    expect(appsAPI.haveInstalledRegistrationsChanged).toHaveBeenCalledTimes(2)
    vi.mocked(appsAPI.haveInstalledRegistrationsChanged).mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(301000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(1)
  })
  it('observes in-place rewrites and case-insensitive protocol shortcuts', async () => {
    appWatcher.init({} as never)
    const watcher = vi.mocked(chokidar.watch).mock.results[0].value as MockWatcherApi
    watcher.__emit('change', 'C:/Fixture/App.LNK')
    await vi.advanceTimersByTimeAsync(1000)
    watcher.__emit('add', 'C:/Fixture/Game.URL')
    await vi.advanceTimersByTimeAsync(1000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(2)
  })
  it('retries an incomplete scan without another filesystem event', async () => {
    vi.mocked(appsAPI.refreshAppsCache).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    appWatcher.init({} as never)
    const watcher = vi.mocked(chokidar.watch).mock.results[0].value as MockWatcherApi
    watcher.__emit('add', 'C:/Fixture/App.lnk')
    await vi.advanceTimersByTimeAsync(1000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(2)
  })
  it('queues events during a scan and never runs overlapping scans', async () => {
    let finish!: (success: boolean) => void
    vi.mocked(appsAPI.refreshAppsCache).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    appWatcher.init({} as never)
    const watcher = vi.mocked(chokidar.watch).mock.results[0].value as MockWatcherApi
    watcher.__emit('add', 'C:/Fixture/First.lnk')
    await vi.advanceTimersByTimeAsync(1000)
    watcher.__emit('add', 'C:/Fixture/Second.lnk')
    uwpMonitorMock.emit({ type: 'install', packageFullName: 'Fixture.Package' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(1)
    expect(appsAPI.refreshUwpAppsCache).not.toHaveBeenCalled()
    finish(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(2)
  })
  it('bounds failed retries and reconciles missed or registry-only installations periodically', async () => {
    vi.mocked(appsAPI.refreshAppsCache).mockRejectedValue(Error('fixture failure'))
    appWatcher.init({} as never)
    const watcher = vi.mocked(chokidar.watch).mock.results[0].value as MockWatcherApi
    watcher.__emit('add', 'C:/Fixture/App.lnk')
    await vi.advanceTimersByTimeAsync(299000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(4)
    vi.mocked(appsAPI.refreshAppsCache).mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(5)
  })
  it('does not revive timers when a stopped watcher receives a late failed scan', async () => {
    let finish!: (success: boolean) => void
    vi.mocked(appsAPI.refreshAppsCache).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    appWatcher.init({} as never)
    const watcher = vi.mocked(chokidar.watch).mock.results[0].value as MockWatcherApi
    watcher.__emit('add', 'C:/Fixture/App.lnk')
    await vi.advanceTimersByTimeAsync(1000)
    appWatcher.stop()
    finish(false)
    await vi.advanceTimersByTimeAsync(600000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('启动递归（depth:5）与扁平（depth:0）两个 watcher', () => {
    appWatcher.init({} as never)

    const watchMock = vi.mocked(chokidar.watch)
    expect(watchMock).toHaveBeenCalledTimes(2)

    const [recursivePaths, recursiveOpts] = watchMock.mock.calls[0]
    const [flatPaths, flatOpts] = watchMock.mock.calls[1]

    expect(recursiveOpts?.depth).toBe(5)
    expect(flatOpts?.depth).toBe(0)
    expect(recursivePaths).toEqual(getWindowsRecursiveScanPaths())
    expect(flatPaths).toEqual(getWindowsFlatScanPaths())
  })

  it('扁平根路径为空时（非 win32，如 darwin）不创建扁平 watcher', () => {
    // getFlatRootWatchPaths 仅 win32 返回非空；其余平台为 []，命中 startWatching 的 length>0 守卫
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    appWatcher.init({} as never)
    const watchMock = vi.mocked(chokidar.watch)
    // 仅创建递归 watcher；扁平 watcher 因路径为空而跳过
    expect(watchMock).toHaveBeenCalledTimes(1)
  })

  it('.lnk add/unlink 事件路由到防抖 notifyChange → refreshAppsCache', async () => {
    appWatcher.init({} as never)

    const watchMock = vi.mocked(chokidar.watch)
    const flatWatcher = watchMock.mock.results[1].value as {
      __emit: (event: string, ...args: unknown[]) => void
    }
    const rootPath = getWindowsFlatScanPaths()[0]
    const lnkPath = path.join(rootPath, 'NewApp.lnk')

    // add 事件：防抖未到时不刷新
    flatWatcher.__emit('add', lnkPath)
    expect(appsAPI.refreshAppsCache).not.toHaveBeenCalled()

    // 推进防抖窗口（DEBOUNCE_DELAY = 1000ms）后刷新
    await vi.advanceTimersByTimeAsync(1000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(1)

    // unlink 事件同样触发刷新
    flatWatcher.__emit('unlink', lnkPath)
    await vi.advanceTimersByTimeAsync(1000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(2)
  })

  it('UWP 包变化完成事件经过防抖后刷新应用缓存', () => {
    appWatcher.init({} as never)

    expect(uwpMonitorMock.start).toHaveBeenCalledTimes(1)
    expect(appsAPI.refreshAppsCacheIfUwpPackagesChanged).toHaveBeenCalledTimes(1)

    // 同一次商店操作可能带来多个包完成事件，应合并成一次 UWP 独立刷新。
    uwpMonitorMock.emit({
      type: 'update',
      packageFullName: 'HillsLite_2.0.0.0_x64__publisher'
    })
    uwpMonitorMock.emit({
      type: 'install',
      packageFullName: 'HillsLite.Resources_2.0.0.0_neutral__publisher'
    })

    expect(appsAPI.refreshUwpAppsCache).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(appsAPI.refreshUwpAppsCache).toHaveBeenCalledTimes(1)
    expect(appsAPI.refreshAppsCache).not.toHaveBeenCalled()
  })

  it('同一防抖窗口内快捷方式变化优先于 UWP 独立刷新', () => {
    appWatcher.init({} as never)
    const watchMock = vi.mocked(chokidar.watch)
    const flatWatcher = watchMock.mock.results[1].value as {
      __emit: (event: string, ...args: unknown[]) => void
    }

    flatWatcher.__emit('add', path.join(getWindowsFlatScanPaths()[0], 'NewApp.lnk'))
    uwpMonitorMock.emit({
      type: 'update',
      packageFullName: 'Publisher.StoreApp_2.0.0.0_x64'
    })
    vi.advanceTimersByTime(1000)

    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(1)
    expect(appsAPI.refreshUwpAppsCache).not.toHaveBeenCalled()
  })

  it('非 .lnk 文件事件不触发刷新', () => {
    appWatcher.init({} as never)
    const watchMock = vi.mocked(chokidar.watch)
    const flatWatcher = watchMock.mock.results[1].value as {
      __emit: (event: string, ...args: unknown[]) => void
    }

    flatWatcher.__emit('add', path.join(getWindowsFlatScanPaths()[0], 'notes.txt'))
    vi.advanceTimersByTime(1000)
    expect(appsAPI.refreshAppsCache).not.toHaveBeenCalled()
  })

  it('stop 关闭两个 watcher', () => {
    appWatcher.init({} as never)
    const watchMock = vi.mocked(chokidar.watch)
    const recursiveWatcher = watchMock.mock.results[0].value as { close: ReturnType<typeof vi.fn> }
    const flatWatcher = watchMock.mock.results[1].value as { close: ReturnType<typeof vi.fn> }

    appWatcher.stop()

    expect(recursiveWatcher.close).toHaveBeenCalledTimes(1)
    expect(flatWatcher.close).toHaveBeenCalledTimes(1)
    expect(uwpMonitorMock.stop).toHaveBeenCalledTimes(1)
  })
})
