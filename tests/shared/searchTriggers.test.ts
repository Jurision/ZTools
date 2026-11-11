import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEARCH_TRIGGERS,
  matchSearchTrigger,
  normalizeSearchShortcut,
  normalizeSearchTriggers,
  searchShortcutFromEvent,
  validateSearchTriggers
} from '../../src/shared/searchTriggers'

describe('local search action bindings', () => {
  it('migrates legacy settings with independent fresh defaults', () => {
    const value = normalizeSearchTriggers()
    expect(value).toEqual(DEFAULT_SEARCH_TRIGGERS)
    value.files.shortcut = 'Alt+F'
    expect(DEFAULT_SEARCH_TRIGGERS.files.shortcut).toBe('')
    expect(normalizeSearchTriggers({ files: { shortcut: 'alt+f' } }).files).toEqual({
      spaceCount: 3,
      shortcut: 'Alt+F'
    })
  })
  it.each([
    ['shift+control+t', 'Ctrl+Shift+T'],
    ['option+f', 'Alt+F'],
    ['cmd+shift+1', 'Shift+Meta+1'],
    ['Ctrl+F12', 'Ctrl+F12'],
    [' Alt+Space ', 'Alt+Space'],
    ['', '']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeSearchShortcut(input)).toBe(expected)
  })
  it.each([
    'a',
    'Space',
    'Shift+T',
    'F12',
    'Ctrl+Enter',
    'Alt+ArrowRight',
    'Ctrl+Tab',
    'Ctrl+Escape',
    'Ctrl+Control+T',
    'T+Ctrl',
    'Ctrl+',
    'Ctrl+F25',
    'Ctrl+字',
    'Ctrl+Shift'
  ])('rejects ordinary typing, navigation and malformed chord %s', (input) => {
    expect(normalizeSearchShortcut(input)).toBeNull()
  })
  it('rejects shared gestures and chords with equivalent spelling', () => {
    const candidate = normalizeSearchTriggers()
    candidate.files.spaceCount = 2
    expect(validateSearchTriggers(candidate)).toContain('空格次数')
    candidate.files.spaceCount = 0
    candidate.files.shortcut = 'Shift+Control+T'
    expect(validateSearchTriggers(candidate)).toContain('相同组合键')
    expect(normalizeSearchTriggers(candidate)).toEqual(DEFAULT_SEARCH_TRIGGERS)
  })
  it.each(['Ctrl+Space', 'Alt+F4', 'Meta+Space', 'Ctrl+Alt+Z'])(
    'rejects reserved global/window chord %s',
    (shortcut) => {
      const value = normalizeSearchTriggers()
      value.files.shortcut = shortcut
      expect(validateSearchTriggers(value, 'Ctrl+Alt+Z')).toContain('唤起或关闭窗口')
    }
  )
  it('supports independently disabled gestures and chords', () => {
    const value = {
      translate: { spaceCount: 0, shortcut: '' },
      files: { spaceCount: 0, shortcut: 'Alt+F' }
    }
    expect(validateSearchTriggers(value)).toBeNull()
    expect(normalizeSearchTriggers(value)).toEqual(value)
    expect(matchSearchTrigger({ key: 'f', altKey: true }, normalizeSearchTriggers(value))).toBe(
      'files'
    )
    expect(
      matchSearchTrigger(
        { key: 't', ctrlKey: true, shiftKey: true },
        normalizeSearchTriggers(value)
      )
    ).toBeNull()
  })
  it('matches exact modifiers and suppresses IME and repeat', () => {
    const event = { key: 'T', ctrlKey: true, shiftKey: true }
    expect(matchSearchTrigger(event, DEFAULT_SEARCH_TRIGGERS)).toBe('translate')
    expect(matchSearchTrigger({ ...event, shiftKey: false }, DEFAULT_SEARCH_TRIGGERS)).toBeNull()
    expect(matchSearchTrigger({ ...event, altKey: true }, DEFAULT_SEARCH_TRIGGERS)).toBeNull()
    expect(matchSearchTrigger({ ...event, isComposing: true }, DEFAULT_SEARCH_TRIGGERS)).toBeNull()
    expect(matchSearchTrigger({ ...event, repeat: true }, DEFAULT_SEARCH_TRIGGERS)).toBeNull()
    expect(searchShortcutFromEvent({ key: ' ', altKey: true })).toBe('Alt+Space')
  })
  it.each([
    null,
    {},
    { translate: { spaceCount: 1 } },
    { translate: { spaceCount: 2, shortcut: 7 } }
  ])('rejects malformed data and recovers defaults', (value) => {
    expect(validateSearchTriggers(value)).toBeTruthy()
    expect(normalizeSearchTriggers(value)).toEqual(DEFAULT_SEARCH_TRIGGERS)
  })
})
