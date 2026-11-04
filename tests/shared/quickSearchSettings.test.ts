import { describe, expect, it } from 'vitest'
import { getStorageScopeForKey, isAccountSyncDoc } from '../../src/main/core/storage/storageRouting'
import { normalizeQuickSearchSettings } from '../../src/shared/quickSearchSettings'
describe('independent built-in quick search switches', () => {
  it('keeps translation credentials device-local and outside account sync', () => {
    expect(getStorageScopeForKey('ZTOOLS/provider-settings')).toBe('device')
    expect(isAccountSyncDoc('ZTOOLS/provider-settings')).toBe(false)
  })
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
