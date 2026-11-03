export interface SearchSources {
  systemSettings: boolean
  files: boolean
  plugins: boolean
  hiddenApplicationNames: string[]
}

export const DEFAULT_HIDDEN_APPLICATION_NAMES = ['Global Flags', '获取帮助', 'Get Help']

/**
 * Normalize old or missing preferences without enabling unrelated search sources.
 * @param value Persisted optional search-source preferences.
 * @returns A fresh preferences object, preserving an explicitly empty hidden list.
 */
export function normalizeSearchSources(value?: unknown): SearchSources {
  const data = value && typeof value === 'object' ? (value as Partial<SearchSources>) : {}
  return {
    systemSettings: data.systemSettings === true,
    files: data.files === true,
    plugins: data.plugins === true,
    hiddenApplicationNames: Array.isArray(data.hiddenApplicationNames)
      ? [
          ...new Set(
            data.hiddenApplicationNames
              .filter((v): v is string => typeof v === 'string')
              .map((v) => v.trim())
              .filter(Boolean)
          )
        ]
      : [...DEFAULT_HIDDEN_APPLICATION_NAMES]
  }
}

/**
 * Interpret an explicit all-command search without changing normal input behavior.
 * @param input Search box text.
 * @returns The searchable text and whether the user explicitly requested all commands.
 */
export function parseSearchScope(input: string): { query: string; explicit: boolean } {
  const text = input.trim()
  return text.startsWith('>')
    ? { query: text.slice(1).trim(), explicit: true }
    : { query: text, explicit: false }
}

interface SearchCommand {
  type?: string
  subType?: string
  searchSource?: string
  name: string
  originalName?: string
  path: string
  targetPath?: string
}

/**
 * Identify document/file launch entries without treating executable shortcuts as files.
 * @param target Resolved shortcut target or direct path.
 * @returns Whether the target is a known document or web link rather than an application.
 */
export function isDocumentSearchTarget(target: string): boolean {
  return (
    /\.(?:txt|md|pdf|docx?|xlsx?|pptx?|rtf|html?|csv|png|jpe?g|gif|webp|zip|7z|rar)$/i.test(
      target
    ) || /^https?:\/\//i.test(target)
  )
}

/**
 * Classify a resolved Windows shortcut target conservatively.
 * @param target Actual launch target supplied by the native scanner.
 * @returns Optional non-application source; known executables and application protocols stay apps.
 */
export function classifyResolvedSearchTarget(
  target: string
): 'files' | 'systemSettings' | undefined {
  const value = target.trim()
  if (/^ms-settings:/i.test(value) || /\.(?:msc|cpl)$/i.test(value)) return 'systemSettings'
  if (/^(?:https?|file):/i.test(value)) return 'files'
  // Drive letters are paths, not application protocols. Keep Steam/UWP/custom app protocols.
  if (/^[a-z][a-z0-9+.-]+:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return undefined
  if (/\.(?:exe|com|bat|cmd|app|desktop)$/i.test(value)) return undefined
  return 'files'
}

/**
 * Keep ordinary results inside the user's selected sources; never mutate command registries.
 * @param command Candidate application, plugin, system setting or local shortcut.
 * @param preferences Normalized source preferences.
 * @param explicit Whether the user entered the all-command prefix.
 * @returns Whether this item may appear in the main search surface.
 */
export function isSearchCommandVisible(
  command: SearchCommand,
  preferences: SearchSources,
  explicit = false
): boolean {
  if (explicit) return true
  if (command.type === 'plugin' || command.type === 'builtin') return preferences.plugins
  const resolvedSource = command.targetPath
    ? classifyResolvedSearchTarget(command.targetPath)
    : undefined
  if (
    command.searchSource === 'systemSettings' ||
    resolvedSource === 'systemSettings' ||
    command.subType === 'system-setting' ||
    /^ms-settings:/i.test(command.path) ||
    /\.(?:msc|cpl)$/i.test(command.path)
  )
    return preferences.systemSettings
  if (
    command.searchSource === 'files' ||
    resolvedSource === 'files' ||
    isDocumentSearchTarget(command.targetPath || command.path)
  )
    return preferences.files
  // Unclassified local shortcuts may be documents, URLs or folders; opt in through files.
  if (
    command.subType === 'local-shortcut' &&
    !/\.(?:exe|com|bat|cmd|app|desktop|lnk)$/i.test(command.path)
  )
    return preferences.files
  if (command.type !== 'direct' && command.type !== 'app') return false
  const names = [command.name, command.originalName || ''].map((v) => v.toLocaleLowerCase())
  return !preferences.hiddenApplicationNames.some((hidden) => {
    const normalized = hidden.toLocaleLowerCase()
    return names.some((name) => name === normalized || name.startsWith(normalized + ' ('))
  })
}

/**
 * Determine whether context/plugin matching is explicitly requested or opted in.
 * @param input Search text, possibly containing an all-command prefix.
 * @param preferences Normalized source preferences.
 * @returns Whether plugin matching may run.
 */
export function allowPluginSearch(input: string, preferences: SearchSources): boolean {
  return preferences.plugins || parseSearchScope(input).explicit
}

/**
 * Recognize only the local translation chord and exclude IME/repeat input.
 * @param event Keyboard event-like object.
 * @returns Whether to translate the current main-search text.
 */
export function isTranslationShortcut(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
  repeat?: boolean
}): boolean {
  return (
    !event.isComposing &&
    !event.repeat &&
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 't'
  )
}
