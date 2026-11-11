interface SpaceKey {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  repeat?: boolean
}

/**
 * Arbitrate double Space translation and triple Space file search before sending any request.
 * @param translate Callback after the complete third-key grace period.
 * @param files Callback when a third Space cancels translation and opens files.
 * @returns Gesture handlers; cancel must run on composition, context changes and disposal.
 */
export function createSearchSpaceGesture(
  translate: (text: string) => void,
  files: (text: string) => void
) {
  let lastSpace = 0
  let pendingText: string | null = null
  let secondAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  /**
   * Clear all pending input gestures without issuing a request.
   * @returns No return value.
   */
  function cancel(): void {
    clearTimeout(timer)
    pendingText = null
    lastSpace = 0
  }
  /**
   * Process one key and decide whether its ordinary text insertion should be suppressed.
   * @param event Local keyboard event.
   * @param value Current input value.
   * @param now Current time, injectable for deterministic tests.
   * @returns Trimmed replacement text for a consumed key, otherwise null.
   */
  function key(event: SpaceKey, value: string, now = Date.now()): string | null {
    const plain =
      event.key === ' ' &&
      !event.repeat &&
      !event.isComposing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey
    if (!plain) {
      cancel()
      return null
    }
    if (pendingText !== null && now - secondAt <= 400) {
      const text = pendingText
      cancel()
      files(text)
      return text
    }
    if (lastSpace > 0 && now - lastSpace <= 400 && /[ \u3000]$/.test(value)) {
      pendingText = value.trimEnd()
      secondAt = now
      const text = pendingText
      // Wait the entire third-press window; an early network request cannot be undone.
      timer = setTimeout(() => {
        cancel()
        if (text) translate(text)
      }, 401)
      return text
    }
    lastSpace = now
    return null
  }
  /**
   * Cancel deferred translation if the input changed independently of the consumed second key.
   * @param value Current input value.
   * @returns No return value.
   */
  function changed(value: string): void {
    if (pendingText !== null && value !== pendingText) cancel()
  }
  return { key, cancel, changed }
}
