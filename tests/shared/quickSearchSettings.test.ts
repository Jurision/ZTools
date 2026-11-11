import { describe, expect, it } from 'vitest'
import { getStorageScopeForKey, isAccountSyncDoc } from '../../src/main/core/storage/storageRouting'
import { normalizeQuickSearchSettings } from '../../src/shared/quickSearchSettings'
import { DEFAULT_SEARCH_TRIGGERS } from '../../src/shared/searchTriggers'
describe('independent built-in quick search switches', () => {
  it('keeps translation credentials device-local and outside account sync', () => {
    expect(getStorageScopeForKey('ZTOOLS/provider-settings')).toBe('device')
    expect(isAccountSyncDoc('ZTOOLS/provider-settings')).toBe(false)
  })
  it('keeps arithmetic and migrates to explicit translation without requiring plugin search', () => {
    const expected = {
      autoCalculate: true,
      autoTranslate: false,
      triggers: DEFAULT_SEARCH_TRIGGERS
    }
    expect(normalizeQuickSearchSettings()).toEqual(expected)
    expect(normalizeQuickSearchSettings(null)).toEqual(expected)
    expect(normalizeQuickSearchSettings({ autoTranslate: true })).toEqual(expected)
  })
  it('preserves each explicit opt-out independently', () => {
    expect(normalizeQuickSearchSettings({ autoCalculate: false })).toEqual({
      autoCalculate: false,
      autoTranslate: false,
      triggers: DEFAULT_SEARCH_TRIGGERS
    })
    expect(normalizeQuickSearchSettings({ autoTranslate: false })).toEqual({
      autoCalculate: true,
      autoTranslate: false,
      triggers: DEFAULT_SEARCH_TRIGGERS
    })
  })
})
