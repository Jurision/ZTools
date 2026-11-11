import { describe, expect, it } from 'vitest'
import { isDoubleSpaceTranslation } from '../../src/shared/searchSources'

const space = { key: ' ', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }

describe('double Space translation trigger', () => {
  it('fires on a second plain Space within 400ms after a typed space', () => {
    expect(isDoubleSpaceTranslation(space, 1000, 'hello world ', 1300)).toBe(true)
    expect(isDoubleSpaceTranslation(space, 1000, '今天天气不错\u3000', 1400)).toBe(true)
  })
  it('does not fire for a single Space, slow presses or empty text', () => {
    expect(isDoubleSpaceTranslation(space, 0, 'hello ', 1000)).toBe(false)
    expect(isDoubleSpaceTranslation(space, 1000, 'hello ', 1401)).toBe(false)
    expect(isDoubleSpaceTranslation(space, 1000, ' ', 1100)).toBe(false)
    expect(isDoubleSpaceTranslation(space, 1000, 'hello', 1100)).toBe(false)
  })
  it('ignores modifiers, auto-repeat, IME composition and other keys', () => {
    for (const event of [
      { ...space, ctrlKey: true },
      { ...space, shiftKey: true },
      { ...space, altKey: true },
      { ...space, metaKey: true },
      { ...space, repeat: true },
      { ...space, isComposing: true },
      { ...space, key: 'a' }
    ])
      expect(isDoubleSpaceTranslation(event, 1000, 'hello ', 1100)).toBe(false)
  })
})
