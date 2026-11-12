export interface ForegroundIdentity {
  app?: string
  pid?: number
  processId?: number
  hwnd?: number
  className?: string
  title?: string
}

export interface ClipboardHistoryFocusOptions {
  ownPid: number
  foreground: () => ForegroundIdentity | null
  searchVisible: () => boolean
  returnToInput: () => void
  externalBlur: () => void
  /** Inspect only shell control identity, never clipboard contents. */
  confirmClipboard?: (window: ForegroundIdentity) => Promise<boolean>
  now?: () => number
}

/**
 * Recognize the shell input host by both executable name and its native UI class.
 * @param window Current foreground identity.
 * @returns Whether it is a supported input-host window, not yet necessarily clipboard history.
 */
export function isWindowsInputHost(window: ForegroundIdentity | null): boolean {
  // Native foreground reads can be partial during focus transitions or access denial.
  if (!window || typeof window.app !== 'string') return false
  const processName = window.app.split(/[\\/]/).pop()?.toLowerCase()
  return (
    (processName === 'textinputhost.exe' || processName === 'textinputhost') &&
    /^(Windows\.UI\.Core\.CoreWindow|Windows\.UI\.Composition\.DesktopWindowContentBridge)$/.test(
      typeof window.className === 'string' ? window.className : ''
    )
  )
}

/**
 * Treat only an explicit clipboard title as sufficient without a local Win+V key event.
 * @param window Current foreground identity.
 * @returns Whether a verified input-host identity explicitly names clipboard history.
 */
export function hasClipboardHistoryTitle(window: ForegroundIdentity | null): boolean {
  return (
    isWindowsInputHost(window) &&
    typeof window?.title === 'string' &&
    /^(clipboard(?: history)?|剪贴板(?:历史记录)?|剪貼簿)$/i.test(window.title.trim())
  )
}

/**
 * Recognize the specific Win+V replacement observed on this machine, not arbitrary Tauri apps.
 * @param window Current foreground identity.
 * @returns Whether executable, native class and title all identify ElegantClipboard.
 */
export function isElegantClipboard(window: ForegroundIdentity | null): boolean {
  return Boolean(
    window &&
    typeof window.app === 'string' &&
    window.app.split(/[\\/]/).pop()?.toLowerCase() === 'elegant-clipboard.exe' &&
    window.className === 'Tauri Window' &&
    window.title === 'ElegantClipboard'
  )
}

/**
 * Temporarily retain the launcher while its own Windows clipboard picker owns focus.
 * No hooks or clipboard reads are used. An unrelated foreground application always wins.
 */
export class ClipboardHistoryFocus {
  private armedUntil = 0
  private active = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private panelHwnd: number | undefined
  private readonly now: () => number

  /**
   * Create one per main search window.
   * @param options Native identity reader and narrow UI callbacks.
   * @returns A dormant focus guard.
   */
  constructor(private readonly options: ClipboardHistoryFocusOptions) {
    this.now = options.now || Date.now
  }

  /**
   * Remember a Win+V observed by this renderer only; never prevent the system shortcut.
   * @param input Electron before-input-event data.
   * @returns No return value.
   */
  observeInput(input: {
    type: string
    key: string
    meta?: boolean
    control?: boolean
    alt?: boolean
    shift?: boolean
  }): void {
    if (input.type !== 'keyDown') return
    if (input.key === 'Meta' || input.key === 'OS') return
    if (
      input.meta &&
      !input.control &&
      !input.alt &&
      !input.shift &&
      input.key.toLowerCase() === 'v'
    ) {
      this.armedUntil = this.now() + 1200
    } else if (input.key !== 'Meta' && input.key !== 'OS') {
      this.armedUntil = 0
    }
  }

  /**
   * Decide whether a blur belongs to clipboard history, checking ambiguous shell windows once.
   * @returns True when this guard owns the eventual hide/return decision.
   */
  handleBlur(): boolean {
    if (!this.options.searchVisible()) return false
    const foreground = this.readForeground()
    if (this.active) return true
    if (isWindowsInputHost(foreground) || isElegantClipboard(foreground)) {
      this.active = true
      const generation = ++this.generation
      // A dedicated clipboard application has no IME/emoji ambiguity. Windows may consume
      // both Win and V before a frameless launcher receives either key, so identity is enough.
      const armed = this.now() < this.armedUntil || isElegantClipboard(foreground)
      if (armed || hasClipboardHistoryTitle(foreground)) {
        this.panelHwnd = foreground?.hwnd
        this.poll()
      } else {
        // TextInputHost also hosts emoji/IME. It alone never grants an exemption.
        void this.confirmAmbiguous(foreground!, generation)
      }
      return true
    }
    // During a Win+V transition Windows may report our own handle for one more frame.
    if (this.now() < this.armedUntil && (!foreground || this.isOwnWindow(foreground))) {
      this.active = true
      this.generation++
      this.schedulePoll()
      return true
    }
    return false
  }

  /**
   * Handle the OS restoring focus after paste or Escape, without re-opening a search session.
   * @returns No return value.
   */
  handleHostFocus(): void {
    if (!this.active) return
    this.reset()
    if (this.options.searchVisible()) this.options.returnToInput()
  }

  /**
   * Stop the bounded clipboard session when hidden, destroyed, or explicitly re-opened.
   * @returns No return value.
   */
  reset(): void {
    this.generation++
    this.active = false
    this.armedUntil = 0
    this.panelHwnd = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /**
   * Catch unavailable native readers without allowing them to keep a stale window open.
   * @returns A foreground identity or null.
   */
  private readForeground(): ForegroundIdentity | null {
    try {
      return this.options.foreground()
    } catch {
      return null
    }
  }

  /**
   * Compare the OS process identity to the launcher process.
   * @param window Current foreground identity.
   * @returns Whether focus belongs to this application's native window.
   */
  private isOwnWindow(window: ForegroundIdentity): boolean {
    return (window.pid ?? window.processId) === this.options.ownPid
  }

  /**
   * Check an ambiguous input host asynchronously and disregard late confirmations.
   * @param window Input-host window to inspect.
   * @param generation Session revision captured before the asynchronous check.
   * @returns Completes after validation or rejection.
   */
  private async confirmAmbiguous(window: ForegroundIdentity, generation: number): Promise<void> {
    let confirmed = false
    try {
      confirmed = (await this.options.confirmClipboard?.(window)) === true
    } catch {
      /* Fail closed. */
    }
    if (generation !== this.generation || !this.active) return
    if (confirmed) {
      this.panelHwnd = window.hwnd
      this.poll()
    } else {
      this.finishExternal()
    }
  }

  /**
   * Hide after an unrelated focus transfer, never taking focus away from another app.
   * @returns No return value.
   */
  private finishExternal(): void {
    this.reset()
    if (this.options.searchVisible()) this.options.externalBlur()
  }

  /**
   * Schedule a low-frequency native identity check only while clipboard history is open.
   * @returns No return value.
   */
  private schedulePoll(): void {
    this.timer = setTimeout(() => {
      this.timer = null
      this.poll()
    }, 80)
    this.timer.unref?.()
  }

  /**
   * Follow the already-recognized picker until the OS returns to ZTools or another app.
   * @returns No return value.
   */
  private poll(): void {
    if (!this.active) return
    if (!this.options.searchVisible()) {
      this.reset()
      return
    }
    const foreground = this.readForeground()
    if (foreground && this.isOwnWindow(foreground)) {
      if (this.panelHwnd === undefined && this.now() < this.armedUntil) this.schedulePoll()
      else this.handleHostFocus()
      return
    }
    if (
      (isWindowsInputHost(foreground) || isElegantClipboard(foreground)) &&
      ((this.panelHwnd !== undefined && this.panelHwnd === foreground?.hwnd) ||
        this.now() < this.armedUntil ||
        isElegantClipboard(foreground))
    ) {
      this.panelHwnd = foreground?.hwnd
      this.schedulePoll()
      return
    }
    if (!foreground && this.now() < this.armedUntil) {
      this.schedulePoll()
      return
    }
    this.finishExternal()
  }
}
