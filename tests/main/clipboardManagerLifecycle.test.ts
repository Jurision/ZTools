import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  put: vi.fn(async () => undefined),
  allDocs: vi.fn(async () => [] as unknown[]),
  readText: vi.fn(() => 'test text'),
  sendPluginMessage: vi.fn(),
  monitors: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>
}))

vi.mock('electron', () => ({
  clipboard: { readImage: () => ({ isEmpty: () => true }), readText: mocks.readText },
  nativeImage: {}
}))
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  promises: { mkdir: mocks.mkdir, writeFile: mocks.writeFile }
}))
vi.mock('../../src/main/core/native', () => {
  class Monitor {
    start = vi.fn()
    stop = vi.fn()
    constructor() {
      mocks.monitors.push(this)
    }
  }
  return { default: Monitor, WindowMonitor: Monitor, WindowManager: {} }
})
vi.mock('../../src/main/utils/clipboardFiles', () => ({
  hasClipboardFiles: () => false,
  readClipboardFilePaths: vi.fn(),
  readClipboardFiles: vi.fn(),
  writeClipboardFiles: vi.fn()
}))
vi.mock('../../src/main/utils/common', () => ({ sleep: vi.fn(async () => undefined) }))
vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: { promises: { put: mocks.put, allDocs: mocks.allDocs } }
}))
vi.mock('../../src/main/core/appData/appDataPaths', () => ({
  getClipboardPath: () => process.env.ZTOOLS_DATA_ROOT
}))
vi.mock('../../src/main/api', () => ({ default: { dbGet: () => null } }))
vi.mock('../../src/main/managers/pluginManager', () => ({
  default: { sendPluginMessage: mocks.sendPluginMessage }
}))

import { ClipboardManager } from '../../src/main/managers/clipboardManager'

/**
 * Yield pending manager initialization and clipboard-processing continuations.
 * @returns Completion of the microtask drain.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/**
 * Create an explicitly controlled asynchronous boundary.
 * @returns Promise and its completion callback.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let manager: ClipboardManager
beforeEach(() => {
  vi.stubEnv('ZTOOLS_BACKGROUND_TEST', '0')
  vi.clearAllMocks()
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.put.mockResolvedValue(undefined)
  mocks.allDocs.mockResolvedValue([])
})
afterEach(() => {
  manager?.cleanup()
  vi.unstubAllEnvs()
})

describe('clipboard manager shutdown', () => {
  it('does not start native listeners when shutdown wins the storage preparation race', async () => {
    const preparation = deferred<void>()
    mocks.mkdir.mockReturnValueOnce(preparation.promise)
    manager = new ClipboardManager()
    const monitors = mocks.monitors.slice(-2)
    manager.cleanup()
    preparation.resolve(undefined)
    await flush()
    expect(monitors.every((monitor) => monitor.start.mock.calls.length === 0)).toBe(true)
    expect(monitors.every((monitor) => monitor.stop.mock.calls.length === 1)).toBe(true)
  })

  it('stops both listeners once and ignores callbacks delivered during or after stop failure', async () => {
    manager = new ClipboardManager()
    await flush()
    const [clipboardMonitor, windowMonitor] = mocks.monitors.slice(-2)
    const clipboardCallback = clipboardMonitor.start.mock.calls[0][0]
    const windowCallback = windowMonitor.start.mock.calls[0][0]
    clipboardMonitor.stop.mockImplementation(() => {
      clipboardCallback()
      throw new Error('fake native stop failure')
    })
    manager.cleanup()
    manager.cleanup()
    clipboardCallback()
    windowCallback({ app: 'late.exe' })
    await flush()
    expect(clipboardMonitor.stop).toHaveBeenCalledTimes(1)
    expect(windowMonitor.stop).toHaveBeenCalledTimes(1)
    expect(mocks.readText).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(manager.getCurrentWindow()).toBeNull()
  })

  it('does not save an item whose preparation completes after shutdown', async () => {
    manager = new ClipboardManager()
    await flush()
    const preparation = deferred<unknown>()
    vi.spyOn(manager as any, 'handleText').mockReturnValueOnce(preparation.promise)
    const work = (manager as any).handleClipboardChange()
    manager.cleanup()
    preparation.resolve({ id: 'fixture', type: 'text', content: 'late', timestamp: 1 })
    await work
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.sendPluginMessage).not.toHaveBeenCalled()
  })

  it('does not start maintenance or notify plugins when an existing write settles after shutdown', async () => {
    manager = new ClipboardManager()
    await flush()
    const write = deferred<void>()
    mocks.put.mockReturnValueOnce(write.promise)
    const work = (manager as any).handleClipboardChange()
    await flush()
    expect(mocks.put).toHaveBeenCalledTimes(1)
    manager.cleanup()
    write.resolve(undefined)
    await work
    expect(mocks.allDocs).not.toHaveBeenCalled()
    expect(mocks.sendPluginMessage).not.toHaveBeenCalled()
  })

  it('releases pending clipboard waiters and refuses new waits on shutdown', async () => {
    manager = new ClipboardManager()
    await flush()
    const waiting = manager.waitForNextCopiedContent(0, 60000)
    manager.cleanup()
    await expect(waiting).resolves.toBeNull()
    await expect(manager.waitForNextCopiedContent(0, 60000)).resolves.toBeNull()
    await expect(manager.getLastCopiedContent(100, 0)).resolves.toBeNull()
    expect((manager as any).lastCopiedSequenceWaiters.size).toBe(0)
  })

  it('cleans a partially started listener if the second listener fails to start', async () => {
    // Hold initialization until the newly created fake monitors can be configured.
    const preparation = deferred<void>()
    mocks.mkdir.mockReturnValueOnce(preparation.promise)
    manager = new ClipboardManager()
    const [clipboardMonitor, windowMonitor] = mocks.monitors.slice(-2)
    windowMonitor.start.mockImplementation(() => {
      throw new Error('fake start failure')
    })
    preparation.resolve(undefined)
    await flush()
    expect(clipboardMonitor.start).toHaveBeenCalledTimes(1)
    expect(clipboardMonitor.stop).toHaveBeenCalledTimes(1)
    expect(windowMonitor.stop).toHaveBeenCalledTimes(1)
    expect((manager as any).isRunning).toBe(false)
  })
})
