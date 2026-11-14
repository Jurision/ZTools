export interface ApplicationIdentity {
  name: string
  path: string
  targetPath?: string
  argumentSignature?: string
  runAsAdmin?: boolean
  applicationId?: string
  installationIdentity?: string
  webApplicationIdentity?: string
  webApplicationStore?: boolean
  applicationName?: string
  aliases?: string[]
  sourcePaths?: string[]
  launchVariants?: ApplicationLaunchVariant[]
  /** Opaque launch settings digest; default denotes a verified ordinary executable launch. */
  launchSignature?: string
}

export interface ApplicationLaunchVariant {
  name: string
  path: string
  targetPath?: string
  launchSignature?: string
  argumentSignature?: string
  runAsAdmin?: boolean
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
 * Identify an installed executable or Store application independently of its display name.
 * @param item Scanned or user-added entry.
 * @returns Installation identity; unrelated file/plugin targets have no executable identity.
 */
export function applicationTargetKey(item: ApplicationIdentity): string | null {
  const target = item.targetPath || item.path
  if (/\.exe$/i.test(target)) return `exe:${normalizeApplicationPath(target)}`
  if (item.path.startsWith('uwp:'))
    return item.webApplicationIdentity ? `web:${item.webApplicationIdentity}` : item.path
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(item.path) && !/^(?:https?|file):/i.test(item.path))
    return `protocol:${item.path}`
  return null
}

/**
 * Distinguish logical hosted apps by arguments, without treating window/admin/workdir as apps.
 * @param item Entry with verified argument digest where available.
 * @returns Logical application identity, or null for unresolved shortcut arguments.
 */
function logicalLaunchKey(item: ApplicationIdentity): string | null {
  const target = applicationTargetKey(item)
  if (!target) return null
  if (!target.startsWith('exe:')) return target
  const args =
    item.argumentSignature ||
    (item.launchSignature === 'default' || !/\.lnk$/i.test(item.path) ? 'default' : null)
  return args ? JSON.stringify([target, args]) : null
}

/**
 * Key search results by the installed application, never by the alias that matched the query.
 * @param item Candidate carrying a canonical group identity when available.
 * @returns Application identity; non-app/unknown entries retain conservative name/path identity.
 */
export function applicationResultKey(item: ApplicationIdentity): string {
  return (
    item.applicationId ||
    logicalLaunchKey(item) ||
    JSON.stringify([item.name.trim().toLowerCase(), normalizeApplicationPath(item.path)])
  )
}

/**
 * Prefer ordinary official shortcuts, retaining exact original launch paths for all variants.
 * @param item Application entry.
 * @returns Lower rank for the default shortcut, then other shortcuts, then bare executables.
 */
function entryPriority(item: ApplicationIdentity): number {
  return (
    (item.webApplicationStore ? -1 : 0) +
    (item.runAsAdmin ? 10 : 0) +
    (/\.lnk$/i.test(item.path) ? 0 : 4) +
    (item.argumentSignature && item.argumentSignature !== 'default' ? 2 : 0) +
    (item.launchSignature && item.launchSignature !== 'default' ? 1 : 0)
  )
}

/**
 * Merge equivalent identities and same-app named launch variants, retaining aliases and actions.
 * Different arguments with different names remain independent hosted apps, such as two PWAs.
 * @param items Ordered scan results; the algorithm is independent of application brand names.
 * @returns One canonical row per group, with other names searchable and launch variants preserved.
 */
export function deduplicateApplications<T extends ApplicationIdentity>(items: T[]): T[] {
  const parents = items.map((_, index) => index)
  /**
   * Find a union root with path compression.
   * @param index Entry index.
   * @returns Root index.
   */
  function root(index: number): number {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]]
      index = parents[index]
    }
    return index
  }
  const seen = new Map<string, number>()
  items.forEach((item, index) => {
    const target = applicationTargetKey(item)
    const keys = item.applicationId ? [item.applicationId] : [applicationResultKey(item)]
    // Same name + same installation is one app even when its optional launch settings differ.
    // Do not use aliases here: a user can assign the same alias to two genuinely different apps.
    if (target && !item.applicationId)
      keys.push(JSON.stringify([target, 'name', item.name.trim().toLowerCase()]))
    for (const key of keys) {
      const previous = seen.get(key)
      if (previous !== undefined) parents[root(index)] = root(previous)
      else seen.set(key, index)
    }
  })
  const groups = new Map<number, T[]>()
  items.forEach((item, index) => {
    const key = root(index)
    const group = groups.get(key) || []
    group.push(item)
    groups.set(key, group)
  })
  return [...groups.values()].map((group) => {
    const canonical = [...group].sort((a, b) => entryPriority(a) - entryPriority(b))[0]
    const aliases: string[] = []
    const names = new Set([canonical.name.trim().toLowerCase()])
    const variants = new Map<string, ApplicationLaunchVariant>()
    const sourcePaths = new Set<string>()
    for (const item of [canonical, ...group.filter((item) => item !== canonical)]) {
      for (const source of [item.path, ...(item.sourcePaths || [])]) sourcePaths.add(source)
      for (const name of [item.name, ...(item.aliases || [])]) {
        const key = name.trim().toLowerCase()
        if (key && !names.has(key)) {
          names.add(key)
          aliases.push(name)
        }
      }
      for (const variant of item.launchVariants || [item]) {
        const key = applicationLaunchKey(variant) || normalizeApplicationPath(variant.path)
        if (!variants.has(key))
          variants.set(key, {
            name: variant.name,
            path: variant.path,
            targetPath: variant.targetPath,
            launchSignature: variant.launchSignature,
            argumentSignature: variant.argumentSignature,
            runAsAdmin: variant.runAsAdmin
          })
      }
    }
    return {
      ...canonical,
      ...(aliases.length ? { aliases } : {}),
      ...(sourcePaths.size > 1 ? { sourcePaths: [...sourcePaths] } : {}),
      ...(variants.size > 1 ? { launchVariants: [...variants.values()] } : {}),
      ...(applicationTargetKey(canonical) ? { applicationId: applicationResultKey(canonical) } : {})
    }
  })
}
