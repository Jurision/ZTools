import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClipboardHistoryFocus,
  isElegantClipboard,
  isWindowsInputHost,
  type ForegroundIdentity
} from '../../src/main/core/clipboardHistoryFocus'

const host: ForegroundIdentity = {
  app: 'TextInputHost.exe',
  pid: 23,
  hwnd: 200,
  className: 'Windows.UI.Core.CoreWindow',
  title: 'Microsoft Text Input Application'
}
const elegant: ForegroundIdentity = {
  app: 'D:\\APP\\ElegantClipboard\\elegant-clipboard.exe',
  pid: 24,
  hwnd: 201,
  className: 'Tauri Window',
  title: 'ElegantClipboard'
}
const own: ForegroundIdentity = {
  app: 'ZTools.exe',
  pid: 1,
  hwnd: 100,
  className: 'Chrome_WidgetWin_1'
}
const other: ForegroundIdentity = { app: 'chrome.exe', pid: 9, hwnd: 300 }
let current: ForegroundIdentity | null
let visible: boolean
let returned: ReturnType<typeof vi.fn>
let hidden: ReturnType<typeof vi.fn>
let guard: ClipboardHistoryFocus

/**
 * Arm only a Win+V key observed in the search window.
 * @returns No return value.
 */
function winV(): void {
  guard.observeInput({ type: 'keyDown', key: 'v', meta: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  current = own
  visible = true
  returned = vi.fn()
  hidden = vi.fn()
  guard = new ClipboardHistoryFocus({
    ownPid: 1,
    foreground: () => current,
    searchVisible: () => visible,
    returnToInput: returned,
    externalBlur: hidden
  })
})
afterEach(() => {
  guard.reset()
  vi.useRealTimers()
})

describe('clipboard picker identity and focus lifetime without global hooks', () => {
  it('requires process and class for Windows input host, and all three fields for ElegantClipboard', () => {
    expect(isWindowsInputHost(host)).toBe(true)
    expect(isWindowsInputHost({ ...host, app: 'other.exe' })).toBe(false)
    expect(isWindowsInputHost({ ...host, className: 'OtherWindow' })).toBe(false)
    expect(isElegantClipboard(elegant)).toBe(true)
    expect(isElegantClipboard({ ...elegant, app: 'different.exe' })).toBe(false)
    expect(isElegantClipboard({ ...elegant, title: 'Settings' })).toBe(false)
    expect(isElegantClipboard({ ...elegant, className: 'Chrome_WidgetWin_1' })).toBe(false)
  })
  it.each([host, elegant])(
    'keeps $app visible, then restores only the input on Escape/OS return',
    (picker) => {
      winV()
      current = picker
      expect(guard.handleBlur()).toBe(true)
      vi.advanceTimersByTime(160)
      expect(hidden).not.toHaveBeenCalled()
      current = own
      vi.advanceTimersByTime(80)
      expect(returned).toHaveBeenCalledTimes(1)
      expect(hidden).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(returned).toHaveBeenCalledTimes(1)
    }
  )
  it('does not whitelist an unarmed generic input host (IME or emoji)', async () => {
    current = host
    expect(guard.handleBlur()).toBe(true)
    await Promise.resolve()
    expect(hidden).toHaveBeenCalledOnce()
    expect(returned).not.toHaveBeenCalled()
  })
  it('does not whitelist unrelated Tauri windows or unarmed ElegantClipboard', () => {
    current = elegant
    expect(guard.handleBlur()).toBe(false)
    winV()
    current = { ...elegant, app: 'other.exe' }
    expect(guard.handleBlur()).toBe(false)
  })
  it('handles OS-consumed V keyDown only for the verified ElegantClipboard identity', () => {
    guard.observeInput({ type: 'keyDown', key: 'Meta', meta: true })
    current = elegant
    expect(guard.handleBlur()).toBe(true)
    current = own
    vi.advanceTimersByTime(80)
    expect(returned).toHaveBeenCalledOnce()
  })
  it('does not broaden a local Windows key to generic input hosts or Tauri apps', async () => {
    guard.observeInput({ type: 'keyDown', key: 'Meta', meta: true })
    current = { ...elegant, title: 'Other app' }
    expect(guard.handleBlur()).toBe(false)
    current = host
    expect(guard.handleBlur()).toBe(true)
    await Promise.resolve()
    expect(hidden).toHaveBeenCalledOnce()
  })
  it('hides normally when the user clicks another app while clipboard history is open', () => {
    winV()
    current = elegant
    guard.handleBlur()
    current = other
    vi.advanceTimersByTime(80)
    expect(hidden).toHaveBeenCalledOnce()
    expect(returned).not.toHaveBeenCalled()
  })
  it('invalidates arming on another key, including Win+period', () => {
    winV()
    guard.observeInput({ type: 'keyDown', key: '.', meta: true })
    current = elegant
    expect(guard.handleBlur()).toBe(false)
  })
  it('never treats Ctrl+V or stale Win+V as a clipboard-history session', () => {
    guard.observeInput({ type: 'keyDown', key: 'v', control: true })
    current = elegant
    expect(guard.handleBlur()).toBe(false)
    winV()
    vi.advanceTimersByTime(1201)
    expect(guard.handleBlur()).toBe(false)
  })
  it('tolerates the brief own-window identity before the picker appears', () => {
    winV()
    expect(guard.handleBlur()).toBe(true)
    vi.advanceTimersByTime(80)
    expect(returned).not.toHaveBeenCalled()
    current = elegant
    vi.advanceTimersByTime(80)
    current = own
    vi.advanceTimersByTime(80)
    expect(returned).toHaveBeenCalledOnce()
  })
  it('stops polling on explicit hide without forcing focus back', () => {
    winV()
    current = elegant
    guard.handleBlur()
    visible = false
    vi.advanceTimersByTime(80)
    expect(vi.getTimerCount()).toBe(0)
    expect(returned).not.toHaveBeenCalled()
    expect(hidden).not.toHaveBeenCalled()
  })
  it('disregards a delayed identity check after the host has regained focus', async () => {
    let resolve: (value: boolean) => void = () => {}
    guard = new ClipboardHistoryFocus({
      ownPid: 1,
      foreground: () => current,
      searchVisible: () => visible,
      returnToInput: returned,
      externalBlur: hidden,
      confirmClipboard: () =>
        new Promise<boolean>((done) => {
          resolve = done
        })
    })
    current = host
    guard.handleBlur()
    guard.handleHostFocus()
    resolve(true)
    await Promise.resolve()
    expect(returned).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(hidden).not.toHaveBeenCalled()
  })
})
