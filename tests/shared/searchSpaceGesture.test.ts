import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSearchSpaceGesture } from '../../src/shared/searchSpaceGesture'
import { normalizeSearchTriggers } from '../../src/shared/searchTriggers'

afterEach(() => vi.useRealTimers())
describe('search Space arbitration', () => {
  it('allows a blank input to translate an attached text block through the caller', () => {
    vi.useFakeTimers()
    const translate = vi.fn()
    const gesture = createSearchSpaceGesture(translate, vi.fn())
    gesture.key({ key: ' ' }, '', 1000)
    gesture.key({ key: ' ' }, ' ', 1100)
    vi.runAllTimers()
    expect(translate).toHaveBeenCalledWith('')
  })
  it('can swap the two gestures without dispatching the double action on triple Space', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const settings = normalizeSearchTriggers({
      translate: { spaceCount: 3 },
      files: { spaceCount: 2 }
    })
    const gesture = createSearchSpaceGesture(translate, files, () => settings)
    gesture.key({ key: ' ' }, 'hello', 1000)
    gesture.key({ key: ' ' }, 'hello ', 1100)
    expect(files).not.toHaveBeenCalled()
    gesture.key({ key: ' ' }, 'hello', 1200)
    vi.runAllTimers()
    expect(translate).toHaveBeenCalledExactlyOnceWith('hello')
    expect(files).not.toHaveBeenCalled()
  })
  it('can disable only the triple gesture and dispatch the double immediately', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const settings = normalizeSearchTriggers({ files: { spaceCount: 0 } })
    const gesture = createSearchSpaceGesture(translate, files, () => settings)
    gesture.key({ key: ' ' }, 'hello', 1000)
    gesture.key({ key: ' ' }, 'hello ', 1100)
    expect(translate).toHaveBeenCalledExactlyOnceWith('hello')
    vi.runAllTimers()
    expect(files).not.toHaveBeenCalled()
  })
  it('can disable both repeated gestures without consuming ordinary spaces', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const settings = normalizeSearchTriggers({
      translate: { spaceCount: 0 },
      files: { spaceCount: 0 }
    })
    const gesture = createSearchSpaceGesture(translate, files, () => settings)
    expect(gesture.key({ key: ' ' }, 'hello', 1000)).toBeNull()
    expect(gesture.key({ key: ' ' }, 'hello ', 1100)).toBeNull()
    expect(gesture.key({ key: ' ' }, 'hello  ', 1200)).toBeNull()
    vi.runAllTimers()
    expect(translate).not.toHaveBeenCalled()
    expect(files).not.toHaveBeenCalled()
  })
  it('can disable translation Space but still enter files on three presses', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const settings = normalizeSearchTriggers({ translate: { spaceCount: 0 } })
    const gesture = createSearchSpaceGesture(translate, files, () => settings)
    gesture.key({ key: ' ' }, 'hello', 1000)
    gesture.key({ key: ' ' }, 'hello ', 1100)
    gesture.key({ key: ' ' }, 'hello', 1200)
    vi.runAllTimers()
    expect(files).toHaveBeenCalledExactlyOnceWith('hello')
    expect(translate).not.toHaveBeenCalled()
  })
  it('preserves two ordinary spaces when only the triple binding is enabled', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const settings = normalizeSearchTriggers({ translate: { spaceCount: 0 } })
    const gesture = createSearchSpaceGesture(translate, files, () => settings)
    expect(gesture.key({ key: ' ' }, 'hello', 1000)).toBeNull()
    expect(gesture.key({ key: ' ' }, 'hello ', 1100)).toBeNull()
    gesture.changed('hello  ')
    vi.runAllTimers()
    expect(files).not.toHaveBeenCalled()
    expect(translate).not.toHaveBeenCalled()
  })
  it('opens the file page with three spaces even when starting with an empty input', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const gesture = createSearchSpaceGesture(translate, files)
    expect(gesture.key({ key: ' ' }, '', 1000)).toBeNull()
    expect(gesture.key({ key: ' ' }, ' ', 1100)).toBe('')
    gesture.key({ key: ' ' }, '', 1200)
    vi.runAllTimers()
    expect(files).toHaveBeenCalledWith('')
    expect(translate).not.toHaveBeenCalled()
  })
  it('leaves slow spaces as ordinary text without translating or opening files', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const gesture = createSearchSpaceGesture(translate, files)
    expect(gesture.key({ key: ' ' }, 'hello', 1000)).toBeNull()
    expect(gesture.key({ key: ' ' }, 'hello ', 1500)).toBeNull()
    expect(gesture.key({ key: ' ' }, 'hello  ', 2000)).toBeNull()
    vi.runAllTimers()
    expect(files).not.toHaveBeenCalled()
    expect(translate).not.toHaveBeenCalled()
  })
  it('waits through the full third-key grace period before translating', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const gesture = createSearchSpaceGesture(translate, files)
    expect(gesture.key({ key: ' ' }, 'hello', 1000)).toBeNull()
    expect(gesture.key({ key: ' ' }, 'hello ', 1100)).toBe('hello')
    vi.advanceTimersByTime(400)
    expect(translate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(translate).toHaveBeenCalledWith('hello')
    expect(files).not.toHaveBeenCalled()
  })
  it('third Space at the boundary produces files only, never a translation request', () => {
    vi.useFakeTimers()
    const translate = vi.fn(),
      files = vi.fn()
    const gesture = createSearchSpaceGesture(translate, files)
    gesture.key({ key: ' ' }, 'hello', 1000)
    gesture.key({ key: ' ' }, 'hello ', 1100)
    vi.advanceTimersByTime(400)
    gesture.key({ key: ' ' }, 'hello', 1500)
    vi.runAllTimers()
    expect(files).toHaveBeenCalledWith('hello')
    expect(translate).not.toHaveBeenCalled()
  })
  it.each([
    { key: ' ', isComposing: true },
    { key: ' ', repeat: true },
    { key: ' ', ctrlKey: true },
    { key: 'x' }
  ])('cancels pending work for %j', (event) => {
    vi.useFakeTimers()
    const translate = vi.fn()
    const gesture = createSearchSpaceGesture(translate, vi.fn())
    gesture.key({ key: ' ' }, 'hello', 1000)
    gesture.key({ key: ' ' }, 'hello ', 1100)
    gesture.key(event, 'hello', 1200)
    vi.runAllTimers()
    expect(translate).not.toHaveBeenCalled()
  })
  it('cancels if input changes or the component is disposed', () => {
    vi.useFakeTimers()
    const translate = vi.fn()
    const gesture = createSearchSpaceGesture(translate, vi.fn())
    gesture.key({ key: ' ' }, 'hello', 1000)
    gesture.key({ key: ' ' }, 'hello ', 1100)
    gesture.changed('different')
    vi.runAllTimers()
    expect(translate).not.toHaveBeenCalled()
  })
})
