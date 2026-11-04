import { describe, expect, it } from 'vitest'
import { normalizeQuickSearchSettings } from '../../src/shared/quickSearchSettings'
describe('independent built-in quick search switches', () => {
  it('defaults both features on without requiring plugin search', () => {
    expect(normalizeQuickSearchSettings()).toEqual({ autoCalculate: true, autoTranslate: true })
    expect(normalizeQuickSearchSettings(null)).toEqual({ autoCalculate: true, autoTranslate: true })
  })
  it('preserves each explicit opt-out independently', () => {
    expect(normalizeQuickSearchSettings({ autoCalculate: false })).toEqual({
      autoCalculate: false,
      autoTranslate: true
    })
    expect(normalizeQuickSearchSettings({ autoTranslate: false })).toEqual({
      autoCalculate: true,
      autoTranslate: false
    })
  })
})
