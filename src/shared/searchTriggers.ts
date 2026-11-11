export type SearchAction = 'translate' | 'files'
export interface SearchTrigger {
  spaceCount: 0 | 2 | 3
  shortcut: string
}
export interface SearchTriggers {
  translate: SearchTrigger
  files: SearchTrigger
}
export interface SearchTriggerKey {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  repeat?: boolean
}
export const DEFAULT_SEARCH_TRIGGERS: SearchTriggers = {
  translate: { spaceCount: 2, shortcut: 'Ctrl+Shift+T' },
  files: { spaceCount: 3, shortcut: '' }
}

/**
 * Canonicalize a bounded local modifier chord; ordinary typing/navigation keys are never accepted.
 * @param value Persisted or user-entered shortcut.
 * @returns Canonical shortcut, empty for disabled, or null for invalid syntax.
 */
export function normalizeSearchShortcut(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null
  if (!value.trim()) return ''
  const tokens = value
    .trim()
    .split('+')
    .map((part) => part.trim())
  const modifiers = new Set<string>()
  let key = ''
  const aliases: Record<string, string> = {
    ctrl: 'Ctrl',
    control: 'Ctrl',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    meta: 'Meta',
    command: 'Meta',
    cmd: 'Meta'
  }
  for (const token of tokens) {
    const modifier = aliases[token.toLowerCase()]
    if (modifier) {
      if (modifiers.has(modifier) || key) return null
      modifiers.add(modifier)
    } else {
      if (key) return null
      key = token.toUpperCase()
    }
  }
  if (![...modifiers].some((value) => ['Ctrl', 'Alt', 'Meta'].includes(value))) return null
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|SPACE)$/.test(key)) return null
  return [
    ...['Ctrl', 'Alt', 'Shift', 'Meta'].filter((value) => modifiers.has(value)),
    key === 'SPACE' ? 'Space' : key
  ].join('+')
}

/**
 * Convert a renderer key event to an eligible local shortcut without registering a global hook.
 * @param event Keyboard event in the focused search/settings input.
 * @returns Canonical chord or null for plain typing, composition and auto-repeat.
 */
export function searchShortcutFromEvent(event: SearchTriggerKey): string | null {
  if (event.isComposing || event.repeat) return null
  const key = event.key === ' ' ? 'Space' : event.key
  return normalizeSearchShortcut(
    [
      ...(event.ctrlKey ? ['Ctrl'] : []),
      ...(event.altKey ? ['Alt'] : []),
      ...(event.shiftKey ? ['Shift'] : []),
      ...(event.metaKey ? ['Meta'] : []),
      key
    ].join('+')
  )
}

/**
 * Validate both local actions together so a gesture never dispatches two actions.
 * @param value Candidate bindings from settings or storage.
 * @param launcherShortcut Current global launcher shortcut, reserved in addition to Ctrl+Space.
 * @returns A concise user-facing error, or null when valid.
 */
export function validateSearchTriggers(
  value: unknown,
  launcherShortcut = 'Ctrl+Space'
): string | null {
  if (!value || typeof value !== 'object') return '快捷键设置格式不正确。'
  const data = value as Partial<SearchTriggers>
  for (const action of ['translate', 'files'] as const) {
    const entry = data[action]
    if (!entry || ![0, 2, 3].includes(entry.spaceCount))
      return '空格触发次数只能选择关闭、两下或三下。'
    const shortcut = normalizeSearchShortcut(entry.shortcut)
    if (shortcut === null)
      return '组合键需包含 Ctrl、Alt 或 Command，并搭配字母、数字、功能键或空格。'
    if (
      shortcut &&
      ['Ctrl+Space', normalizeSearchShortcut(launcherShortcut), 'Alt+F4', 'Meta+Space'].includes(
        shortcut
      )
    )
      return '该组合键用于唤起或关闭窗口，请选择其他组合键。'
  }
  if (data.translate!.spaceCount && data.translate!.spaceCount === data.files!.spaceCount)
    return '翻译和文件搜索不能使用相同的空格次数。'
  const translate = normalizeSearchShortcut(data.translate!.shortcut)
  if (translate && translate === normalizeSearchShortcut(data.files!.shortcut))
    return '翻译和文件搜索不能使用相同组合键。'
  return null
}

/**
 * Migrate missing preferences and discard invalid/conflicting persisted bindings as one unit.
 * @param value Optional persisted bindings.
 * @returns Fresh valid bindings; defaults preserve the existing double/triple Space behavior.
 */
export function normalizeSearchTriggers(value?: unknown): SearchTriggers {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<SearchTriggers>
  const result = {
    translate: { ...DEFAULT_SEARCH_TRIGGERS.translate, ...data.translate },
    files: { ...DEFAULT_SEARCH_TRIGGERS.files, ...data.files }
  }
  if (validateSearchTriggers(result))
    return {
      translate: { ...DEFAULT_SEARCH_TRIGGERS.translate },
      files: { ...DEFAULT_SEARCH_TRIGGERS.files }
    }
  return {
    translate: {
      spaceCount: result.translate.spaceCount,
      shortcut: normalizeSearchShortcut(result.translate.shortcut)!
    },
    files: {
      spaceCount: result.files.spaceCount,
      shortcut: normalizeSearchShortcut(result.files.shortcut)!
    }
  }
}

/**
 * Match one explicit local chord against validated per-action bindings.
 * @param event Key event from the main search input.
 * @param triggers Valid local action bindings.
 * @returns One action or null; callers handle context/focus and preventDefault.
 */
export function matchSearchTrigger(
  event: SearchTriggerKey,
  triggers: SearchTriggers
): SearchAction | null {
  const shortcut = searchShortcutFromEvent(event)
  if (!shortcut) return null
  return (
    (['translate', 'files'] as const).find((action) => triggers[action].shortcut === shortcut) ||
    null
  )
}
