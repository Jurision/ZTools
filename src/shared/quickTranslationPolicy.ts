export interface QuickTranslationContext {
  hasAppMatches: boolean
  appNames?: readonly string[]
}

export type QuickTranslationReason =
  | 'eligible'
  | 'empty'
  | 'too-long'
  | 'address-or-path'
  | 'non-natural-text'
  | 'sensitive-text'
  | 'app-match'
  | 'abbreviation'
  | 'too-short'

export interface QuickTranslationDecision {
  eligible: boolean
  normalizedText: string
  reason: QuickTranslationReason
}

const COMMON_APP_NAMES = [
  'utools',
  'ztools',
  'chrome',
  'edge',
  'firefox',
  'safari',
  'codex',
  'claude',
  'vscode',
  'visual studio code',
  'notepad',
  'powershell',
  'terminal',
  'wechat',
  '微信',
  'qq',
  'word',
  'excel',
  'outlook',
  'photoshop',
  'git',
  'git bash',
  'steam',
  'docker',
  'obs'
]

/**
 * Assess automatic translation disclosure using conservative natural-language rules.
 * @param input User-entered text; never sent by this function.
 * @param context Current application matches and installed application names/aliases.
 * @param options Explicit translation bypasses app/abbreviation heuristics, but retains sensitive-input guards.
 * @returns An auditable eligibility reason and normalized text.
 */
export function evaluateQuickTranslation(
  input: string,
  context: QuickTranslationContext,
  options: { explicit?: boolean } = {}
): QuickTranslationDecision {
  const normalizedText = input.trim().replace(/\s+/g, ' ')
  /**
   * Construct a policy result without revealing input outside the caller.
   * @param reason Auditable eligibility decision.
   * @returns Decision with normalized input.
   */
  const decision = (reason: QuickTranslationReason): QuickTranslationDecision => ({
    eligible: reason === 'eligible',
    normalizedText,
    reason
  })
  if (!normalizedText) return decision('empty')
  if (normalizedText.length > 256) return decision('too-long')
  // Addresses, filesystem fragments and explicit command mode never leave the search box automatically.
  if (
    /[\\/@:]|(?:https?|file|mailto)\b|\b[a-z0-9-]+\.(?:[a-z]{2,})(?:\b|$)|^>|^[.~]/i.test(
      normalizedText
    )
  )
    return decision('address-or-path')
  if (
    /\b(?:password|passwd|pwd|secret|token|api[ -]?key|authorization|bearer|private[ -]?key|recovery[ -]?phrase)\b|密码|口令|密钥|验证码|助记词/i.test(
      normalizedText
    )
  )
    return decision('sensitive-text')
  // Digits and non-language operators exclude expressions, identifier tokens and mixed-character credentials.
  if (
    /\d/u.test(normalizedText) ||
    !/^[\p{Script=Han}a-zA-Z\s，。！？、；“”‘’（）.,!?'"-]+$/u.test(normalizedText)
  )
    return decision('non-natural-text')
  if (/^[a-zA-Z]{25,}$/.test(normalizedText) || /[a-z][A-Z][a-z]*[A-Z]/.test(normalizedText))
    return decision('sensitive-text')
  if (!options.explicit) {
    const names = [...COMMON_APP_NAMES, ...(context.appNames || [])]
    if (names.some((name) => name.trim().toLowerCase() === normalizedText.toLowerCase()))
      return decision('app-match')
    if (/^[a-zA-Z]+$/.test(normalizedText) && context.hasAppMatches) return decision('app-match')
    // Short Chinese with an app hit is an app search (网易, 腾讯会议); longer sentences still translate.
    if (/^\p{Script=Han}{1,4}$/u.test(normalizedText) && context.hasAppMatches)
      return decision('app-match')
    if (/^[A-Z\s]+$/.test(normalizedText)) return decision('abbreviation')
  }
  if (/\p{Script=Han}/u.test(normalizedText)) return decision('eligible')
  if (
    /^[a-zA-Z .,!?'"-]+$/.test(normalizedText) &&
    normalizedText.includes(' ') &&
    (normalizedText.match(/[a-zA-Z]+/g)?.length || 0) >= 2
  )
    return decision('eligible')
  if (
    /^[a-zA-Z]{3,}$/.test(normalizedText) ||
    (options.explicit && /^[a-zA-Z]+$/.test(normalizedText))
  )
    return decision('eligible')
  return decision('too-short')
}
