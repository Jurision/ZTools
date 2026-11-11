import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockHandler = (...args: any[]) => void

const mocks = vi.hoisted(() => {
  const appFocus = vi.fn()
  const appHide = vi.fn()
  const appShow = vi.fn()
  const appIsHidden = vi.fn(() => false)
  const dbGet = vi.fn()
  const clipboardGetCurrentWindow = vi.fn()
  const clipboardActivateApp = vi.fn()
  const globalInputOn = vi.fn()
  const globalInputAcquire = vi.fn()
  const globalInputRelease = vi.fn()
  const shortcutCallbacks = new Map<string, () => void>()
  const nativeActivate = vi.fn()
  const latestWindow = { current: null as any }

  /**
   * Model window visibility and focus without creating native windows.
   * @returns An isolated Electron window double.
   */
  const createMockWindow = (): any => {
    const handlers: Record<string, MockHandler[]> = {}
    const webContentsHandlers: Record<string, MockHandler[]> = {}

    /**
     * Deliver a synthetic window event to registered handlers.
     * @param event Window event name.
     * @param args Arguments passed to each handler.
     * @returns No return value.
     */
    const emit = (event: string, ...args: any[]): void => {
      for (const handler of handlers[event] || []) {
        handler(...args)
      }
    }

    let visible = false
    let focused = false
    const win = {
      webContents: {
        setZoomFactor: vi.fn(),
        setVisualZoomLevelLimits: vi.fn(),
        on: vi.fn((event: string, handler: MockHandler) => {
          ;(webContentsHandlers[event] ||= []).push(handler)
        }),
        focus: vi.fn(),
        send: vi.fn(),
        getURL: vi.fn(() => 'app://ztools')
      },
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setPosition: vi.fn(),
      getPosition: vi.fn(() => [100, 100]),
      getBounds: vi.fn(() => ({ x: 100, y: 100, width: 800, height: 600 })),
      isFocused: vi.fn(() => focused),
      isVisible: vi.fn(() => visible),
      show: vi.fn(() => {
        visible = true
        emit('show')
      }),
      moveTop: vi.fn(),
      emit,
      hide: vi.fn(() => {
        visible = false
        focused = false
        emit('hide')
      }),
      minimize: vi.fn(),
      blur: vi.fn(() => {
        focused = false
        emit('blur')
      }),
      focus: vi.fn(() => {
        focused = true
        emit('focus')
      }),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      on: vi.fn((event: string, handler: MockHandler) => {
        ;(handlers[event] ||= []).push(handler)
      }),
      once: vi.fn((event: string, handler: MockHandler) => {
        ;(handlers[event] ||= []).push(handler)
      })
    }

    latestWindow.current = win
    return win
  }

  return {
    shortcutCallbacks,
    nativeActivate,
    appFocus,
    appHide,
    appShow,
    appIsHidden,
    dbGet,
    clipboardGetCurrentWindow,
    clipboardActivateApp,
    globalInputOn,
    globalInputAcquire,
    globalInputRelease,
    latestWindow,
    createMockWindow
  }
})

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
  platform: { isMacOS: false, isWindows: true, isLinux: false }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/ztools'),
    focus: mocks.appFocus,
    hide: mocks.appHide,
    show: mocks.appShow,
    isHidden: mocks.appIsHidden,
    dock: {
      show: vi.fn(),
      hide: vi.fn()
    }
  },
  BrowserWindow: vi.fn(function BrowserWindowMock() {
    return mocks.createMockWindow()
  }),
  globalShortcut: {
    register: vi.fn((key: string, callback: () => void) => {
      mocks.shortcutCallbacks.set(key, callback)
      return true
    }),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false)
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({}))
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      setTemplateImage: vi.fn()
    }))
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 300, y: 300 })),
    getDisplayNearestPoint: vi.fn(() => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  },
  Tray: vi.fn(() => ({
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    popUpContextMenu: vi.fn()
  }))
}))

vi.mock('../../src/main/api', () => ({
  default: {
    dbGet: vi.fn(() => null),
    launchPlugin: vi.fn()
  }
}))

vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: mocks.dbGet,
    dbPut: vi.fn()
  }
}))

vi.mock('../../src/main/core/doubleTapManager.js', () => ({
  default: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn()
  }
}))

vi.mock('../../src/main/core/globalInputManager.js', () => ({
  default: {
    on: mocks.globalInputOn,
    acquire: mocks.globalInputAcquire,
    release: mocks.globalInputRelease
  }
}))

vi.mock('../../src/main/core/native/index.js', () => ({
  WindowManager: {
    activateWindow: mocks.nativeActivate,
    getActiveWindow: vi.fn(() => ({ app: 'another-app.exe', pid: 123 }))
  }
}))

vi.mock('../../src/main/managers/clipboardManager', () => ({
  default: {
    getCurrentWindow: mocks.clipboardGetCurrentWindow,
    activateApp: mocks.clipboardActivateApp
  }
}))

vi.mock('../../src/main/core/detachedWindowManager', () => ({
  default: {
    hasDetachedWindows: vi.fn(() => false)
  }
}))

vi.mock('../../src/main/core/superPanelManager', () => ({
  default: {
    broadcastToSuperPanel: vi.fn()
  }
}))

vi.mock('../../src/main/utils/windowUtils', () => ({
  applyWindowMaterial: vi.fn(),
  getDefaultWindowMaterial: vi.fn(() => 'none')
}))

vi.mock('../../src/main/managers/pluginManager', () => ({
  default: {
    getCurrentPluginPath: vi.fn(() => null),
    restoreCurrentPluginViewHeightOnWindowShow: vi.fn(),
    isPluginViewFocused: vi.fn(() => false),
    focusPluginView: vi.fn(),
    forceRepaintCurrentView: vi.fn(),
    hidePluginView: vi.fn(),
    handlePluginEsc: vi.fn(),
    shouldSuppressMainHide: vi.fn(() => false)
  }
}))

vi.mock('../../src/main/core/dndManager.js', () => ({
  default: { shouldIgnoreHotkeys: vi.fn(() => false) }
}))

describe('windowManager Windows first shortcut activation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.shortcutCallbacks.clear()
    mocks.dbGet.mockReturnValue(null)
    mocks.clipboardGetCurrentWindow.mockReturnValue(null)
    mocks.clipboardActivateApp.mockReturnValue(true)
    mocks.latestWindow.current = null
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps the first Ctrl+Space activation visible through a transient Windows blur', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.createWindow()
    windowManager.registerShortcut('Ctrl+Space')
    const win = mocks.latestWindow.current
    expect(win.isVisible()).toBe(false)

    // Reproduce the shell returning focus briefly during the first native show.
    const originalShow = win.show.getMockImplementation()!
    win.show.mockImplementationOnce(() => {
      originalShow()
      win.blur()
    })
    mocks.shortcutCallbacks.get('Ctrl+Space')!()
    expect(win.isVisible()).toBe(true)
    expect(win.hide).not.toHaveBeenCalled()

    vi.advanceTimersByTime(80)
    expect(mocks.nativeActivate).toHaveBeenCalledWith(process.pid)
    expect(win.isFocused()).toBe(true)
    expect(win.webContents.send).toHaveBeenCalledWith('focus-search', null)

    // Genuine loss of focus still dismisses the launcher after the activation settles.
    vi.advanceTimersByTime(271)
    win.blur()
    expect(win.isVisible()).toBe(false)
    expect(win.hide).toHaveBeenCalledTimes(1)
  })

  it('allows the next shortcut press to close the panel and does not reopen from a stale refocus', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.createWindow()
    windowManager.registerShortcut('Ctrl+Space')
    const win = mocks.latestWindow.current
    const shortcut = mocks.shortcutCallbacks.get('Ctrl+Space')!
    shortcut()
    expect(win.isVisible()).toBe(true)
    shortcut()
    expect(win.isVisible()).toBe(false)
    vi.advanceTimersByTime(400)
    expect(win.isVisible()).toBe(false)
    expect(mocks.nativeActivate).not.toHaveBeenCalled()
  })
})
