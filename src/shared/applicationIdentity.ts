export interface ApplicationIdentity {
  name: string
  path: string
  targetPath?: string
  /** Opaque launch settings digest; default denotes a verified ordinary executable launch. */
  launchSignature?: string
}

/**
 * Normalize Windows filesystem identity without changing case-sensitive URLs or other platforms.
 * @param value Executable, shortcut or protocol path.
 * @returns Stable path key; does not resolve symlinks or guess installation/version roots.
 */
export function normalizeApplicationPath(value: string): string {
  const trimmed = value.trim().replace(/^"(.*)"$/, '$1')
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(trimmed)
    ? trimmed.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    : trimmed
}

/**
 * Identify a known executable launch, preserving arguments, profiles and special launch settings.
 * @param item Scanned application or manually added entry.
 * @returns Launch identity, or null when shortcut metadata is missing or cannot be trusted.
 */
export function applicationLaunchKey(item: ApplicationIdentity): string | null {
  const target = item.targetPath || item.path
  if (!/\.exe$/i.test(target)) return null
  if (/\.lnk$/i.test(item.path) && (!item.targetPath || !item.launchSignature)) return null
  const signature = item.launchSignature || 'default'
  return JSON.stringify([normalizeApplicationPath(target), signature])
}

/**
 * Build one application-result key; deliberate aliases remain searchable as separate names.
 * @param item Candidate result with optional launch metadata.
 * @returns Name plus proven launch identity, falling back to the entry path when unknown.
 */
export function applicationResultKey(item: ApplicationIdentity): string {
  return JSON.stringify([
    item.name.trim().toLowerCase(),
    applicationLaunchKey(item) || normalizeApplicationPath(item.path)
  ])
}

/**
 * Keep the first canonical entry while preserving uncertain identities and input objects.
 * @param items Ordered candidates; put official shortcuts before discovered executable fallbacks.
 * @returns New array containing one row per proven identity and display name.
 */
export function deduplicateApplications<T extends ApplicationIdentity>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = applicationResultKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
