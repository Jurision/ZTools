export interface QuickSearchSettings {
  autoCalculate: boolean
  autoTranslate: boolean
}

/**
 * Default built-in quick results on without changing plugin search preferences.
 * @param value Optional persisted preferences.
 * @returns Validated independent feature switches.
 */
export function normalizeQuickSearchSettings(value?: unknown): QuickSearchSettings {
  const settings = (value && typeof value === 'object' ? value : {}) as Partial<QuickSearchSettings>
  return {
    autoCalculate: settings.autoCalculate !== false,
    autoTranslate: settings.autoTranslate !== false
  }
}
