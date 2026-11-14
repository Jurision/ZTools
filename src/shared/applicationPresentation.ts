import {
  normalizedApplicationName,
  normalizeApplicationPath,
  type ApplicationIdentity
} from './applicationIdentity'

/**
 * Describe a source only when another independent result has the same visible name.
 * @param item Canonical application with optional verified version/browser metadata.
 * @returns Compact, factual source label; unknown versions are never invented.
 */
function sourceLabel(item: ApplicationIdentity): string {
  if (item.webBrowserHost) {
    const host = item.webBrowserHost
      .split('!')[0]
      .split('_')[0]
      .replace(/^Microsoft\.MicrosoftEdge/i, 'Edge')
      .replace(/\./g, ' ')
      .replace(/\bStable\b/i, '正式版')
      .replace(/\bDev\b/i, 'Dev')
    return [
      host,
      item.webBrowserProfile && item.webBrowserProfile !== 'Default' ? item.webBrowserProfile : ''
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (item.targetVersion && !/^0(?:\.0)*$/.test(item.targetVersion.trim()))
    return `版本 ${item.targetVersion.trim()}`
  if (item.path.startsWith('uwp:')) return item.path.split('!').pop() || item.path
  const target = (item.targetPath || item.path).replace(/\\/g, '/')
  return `安装目录：${target.split('/').slice(-2, -1)[0] || target}`
}

/**
 * Ensure retained same-name installations are distinguishable without changing search/launch IDs.
 * @param entries Deduplicated applications before aliases are expanded.
 * @returns Copies with details only for colliding names, recomputed on every refresh.
 */
export function annotateApplicationChoices<T extends ApplicationIdentity>(entries: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const item of entries) {
    const key = normalizedApplicationName(item.name)
    groups.set(key, [...(groups.get(key) || []), item])
  }
  return entries.map((item) => {
    const group = groups.get(normalizedApplicationName(item.name))!
    let detail = group.length > 1 ? sourceLabel(item) : undefined
    if (detail && group.filter((other) => sourceLabel(other) === detail).length > 1)
      detail += ` · ${normalizeApplicationPath(item.targetPath || item.path)}`
    if (
      detail &&
      group.some(
        (other) =>
          other !== item &&
          normalizeApplicationPath(other.targetPath || other.path) ===
            normalizeApplicationPath(item.targetPath || item.path) &&
          sourceLabel(other) === sourceLabel(item)
      )
    )
      detail += ` · ${item.path}`
    return { ...item, applicationDetail: detail }
  })
}
