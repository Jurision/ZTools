export type AvatarAction =
  | { type: 'settings' | 'plugin-menu' | 'none' }
  | { type: 'ai'; text: string }

/**
 * Resolve an explicit avatar click without sending ordinary search input automatically.
 * @param view Current host view.
 * @param input Search input.
 * @param pastedText Optional text block.
 * @param composing Whether IME input is unfinished.
 * @returns The single action requested by this click.
 */
export function resolveAvatarAction(
  view: string | undefined,
  input: string,
  pastedText?: string | null,
  composing = false
): AvatarAction {
  if (view === 'plugin') return { type: 'plugin-menu' }
  if (composing) return { type: 'none' }
  const text = [pastedText?.trim(), input.trim()].filter(Boolean).join('\n\n')
  return text ? { type: 'ai', text } : { type: 'settings' }
}
