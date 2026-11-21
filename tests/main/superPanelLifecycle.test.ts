import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  monitoring: false,
  cursor: vi.fn(() => ({ x: 10, y: 20 })),
  dbGet: vi.fn(),
  dbPut: vi.fn(),
  copied: vi.fn(),
  translate: vi.fn(),
  send: vi.fn(),
  simulate: vi.fn(),
  browserWindow: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    on: mocks.on,
    removeListener: mocks.removeListener,
    handle: mocks.handle,
    removeHandler: mocks.removeHandler
  },
  BrowserWindow: mocks.browserWindow,
  screen: { getCursorScreenPoint: mocks.cursor }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../src/main/utils/appBundlePath', () => ({
  getPreloadPath: vi.fn(),
  getRendererPath: vi.fn()
}))
vi.mock('../../src/main/core/native/index.js', () => ({
  ClipboardMonitor: {},
  MouseMonitor: {
    start: mocks.start,
    stop: mocks.stop,
    get isMonitoring() {
      return mocks.monitoring
    }
  },
  WindowManager: { simulateKeyboardTap: mocks.simulate }
}))
vi.mock('../../src/main/core/commandLauncher/index.js', () => ({ launchApp: vi.fn() }))
vi.mock('../../src/main/api/shared/database.js', () => ({
  default: { dbGet: mocks.dbGet, dbPut: mocks.dbPut }
}))
vi.mock('../../src/main/core/dndManager.js', () => ({ default: {} }))
vi.mock('../../src/main/api/renderer/plugins.js', () => ({
  default: { getDisabledPluginSet: () => new Set() }
}))
vi.mock('../../src/main/managers/windowManager.js', () => ({ default: {} }))
vi.mock('../../src/main/managers/clipboardManager.js', () => ({
  default: { getLastCopiedSequence: () => 1, getLastCopiedContent: mocks.copied }
}))
vi.mock('../../src/main/utils/windowUtils.js', () => ({
  applyWindowMaterial: vi.fn(),
  getDefaultWindowMaterial: vi.fn()
}))
vi.mock('../../src/main/core/provider/providerManager.js', () => ({
  default: { invoke: mocks.translate }
}))
vi.mock('../../src/main/utils/common', () => ({ decodeFileUrlToPath: vi.fn() }))
vi.mock('../../src/main/core/backgroundTestMode', () => ({ isBackgroundTest: () => false }))

import { SuperPanelManager } from '../../src/main/core/superPanelManager'

let manager: SuperPanelManager
beforeEach(() => {
  vi.stubEnv('ZTOOLS_BACKGROUND_TEST', '0')
  vi.clearAllMocks()
  mocks.monitoring = false
  mocks.start.mockImplementation(() => {
    mocks.monitoring = true
  })
  mocks.stop.mockImplementation(() => {
    mocks.monitoring = false
  })
  mocks.dbGet.mockReturnValue({ superPanelEnabled: true, superPanelMouseButton: 'right' })
  manager = new SuperPanelManager()
  manager.init({ webContents: { send: mocks.send }, isDestroyed: () => false } as any, {} as any)
})
afterEach(() => {
  manager.cleanup()
  vi.unstubAllEnvs()
})

describe('super panel shutdown', () => {
  it('stops its mouse listener and removes exactly its owned IPC subscriptions once', () => {
    const ownedListeners = mocks.on.mock.calls.slice()
    const ownedHandlers = mocks.handle.mock.calls.map(([channel]) => channel)
    manager.cleanup()
    manager.cleanup()
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.removeListener.mock.calls).toEqual(ownedListeners)
    expect(mocks.removeHandler.mock.calls).toEqual(ownedHandlers.map((channel) => [channel]))
    manager.updateConfig({ enabled: true, mouseButton: 'right', longPressMs: 500 })
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })

  it('invalidates callbacks before native stop and still removes IPC if stop fails', () => {
    mocks.stop.mockImplementation(() => {
      expect((manager as any).onMouseTrigger()).toEqual({ shouldBlock: false })
      throw new Error('fake native stop failure')
    })
    const lateUpdate = mocks.handle.mock.calls.find(
      ([channel]) => channel === 'super-panel:update-pinned-order'
    )![1]
    manager.cleanup()
    expect(mocks.removeHandler).toHaveBeenCalled()
    expect(mocks.removeListener).toHaveBeenCalled()
    expect(mocks.cursor).not.toHaveBeenCalled()
    lateUpdate({}, ['late mutation'])
    expect(mocks.dbPut).not.toHaveBeenCalled()
  })

  it('does not show a panel or start a translation when pending clipboard work finishes late', async () => {
    let finish!: (value: unknown) => void
    mocks.copied.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const pending = (manager as any).onMouseTriggerAsync({ x: 10, y: 20 })
    expect(mocks.simulate).toHaveBeenCalledTimes(1)
    manager.cleanup()
    finish({ type: 'text', data: 'fixture', timestamp: 1, sequence: 2 })
    await pending
    expect(mocks.browserWindow).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.translate).not.toHaveBeenCalled()
  })

  it('drops a translation response and queued messages after cleanup', async () => {
    let finish!: (value: unknown) => void
    mocks.translate.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const pending = (manager as any).requestTranslation('fixture')
    manager.cleanup()
    finish({ text: 'translated fixture' })
    await pending
    expect((manager as any).pendingMessages).toEqual([])
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
