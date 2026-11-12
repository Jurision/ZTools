/**
 * Compare Windows search targets consistently without matching neighboring paths.
 * @param value File path, shortcut target or application identifier.
 * @returns Case-insensitive key with consistent separators.
 */
export function searchPathKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Normalize persisted exact-path exclusions, preserving display spelling.
 * @param value Optional list from settings or IPC.
 * @returns A bounded list of distinct nonempty targets.
 */
export function normalizeHiddenPaths(value: unknown): string[] {
  const entries = new Map<string, string>()
  if (!Array.isArray(value)) return []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > 4096 || /[\r\n\0]/.test(item))
      continue
    entries.set(searchPathKey(item), item.trim())
    if (entries.size >= 1000) break
  }
  return [...entries.values()]
}

/**
 * Check one exact target; children and similarly named files remain searchable.
 * @param target Candidate path or application identifier.
 * @param hidden Stored excluded targets.
 * @returns Whether this exact target is excluded.
 */
export function isHiddenSearchPath(target: string, hidden?: string[]): boolean {
  const key = searchPathKey(target)
  return Boolean(hidden?.some((item) => searchPathKey(item) === key))
}
