import { normalizeSearchTriggers, type SearchTriggers } from './searchTriggers'

export interface QuickSearchSettings {
  autoCalculate: boolean
  autoTranslate: boolean
  triggers: SearchTriggers
}

/**
 * Keep arithmetic independent while disabling legacy implicit translation and migrating local triggers.
 * @param value Optional persisted preferences.
 * @returns Validated independent feature switches.
 */
export function normalizeQuickSearchSettings(value?: unknown): QuickSearchSettings {
  const settings = (value && typeof value === 'object' ? value : {}) as Partial<QuickSearchSettings>
  return {
    autoCalculate: settings.autoCalculate !== false,
    autoTranslate: false,
    triggers: normalizeSearchTriggers(settings.triggers)
  }
}
