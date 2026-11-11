import {
  DEFAULT_SEARCH_TRIGGERS,
  type SearchTriggers,
  type SearchTriggerKey
} from './searchTriggers'

/**
 * Arbitrate configured repeated-Space actions without sending translation before a possible third press.
 * @param translate Explicit translation callback; empty input may refer to a selected text block.
 * @param files Callback to enter the file page.
 * @param bindings Current validated settings, read on every key to support immediate settings changes.
 * @returns Gesture handlers; cancel on composition, context/settings changes and disposal.
 */
export function createSearchSpaceGesture(
  translate: (text: string) => void,
  files: (text: string) => void,
  bindings: () => SearchTriggers = () => DEFAULT_SEARCH_TRIGGERS
) {
  let lastSpace = 0
  let pendingText: string | null = null
  let pendingInputValue: string | null = null
  let secondAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  /**
   * Clear all pending input gestures without issuing a request.
   * @returns No return value.
   */
  function cancel(): void {
    clearTimeout(timer)
    pendingText = null
    pendingInputValue = null
    lastSpace = 0
  }
  /**
   * Process one key and decide whether its ordinary text insertion should be suppressed.
   * @param event Local keyboard event.
   * @param value Current input value.
   * @param now Current time, injectable for deterministic tests.
   * @returns Trimmed replacement text for a consumed key, otherwise null.
   */
  function key(event: SearchTriggerKey, value: string, now = Date.now()): string | null {
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
    const current = bindings()
    /**
     * Resolve a configured repeated-key count to one action callback.
     * @param count Repeated Space count.
     * @returns Bound callback, or undefined when that count is disabled.
     */
    const actionAt = (count: number) =>
      current.translate.spaceCount === count
        ? translate
        : current.files.spaceCount === count
          ? files
          : undefined
    const double = actionAt(2)
    const triple = actionAt(3)
    if (!double && !triple) {
      cancel()
      return null
    }
    if (pendingText !== null && now - secondAt <= 400 && triple) {
      const text = pendingText
      cancel()
      triple(text)
      return text
    }
    if (lastSpace > 0 && now - lastSpace <= 400 && /[ \u3000]$/.test(value)) {
      pendingText = value.trimEnd()
      // With only a triple binding, two Spaces remain ordinary editable text.
      pendingInputValue = double ? pendingText : `${value} `
      secondAt = now
      const text = pendingText
      if (!triple) {
        cancel()
        double?.(text)
      } else {
        // Even when triple is translation and double is files, dispatch exactly one action.
        timer = setTimeout(() => {
          cancel()
          double?.(text)
        }, 401)
      }
      return double ? text : null
    }
    lastSpace = now
    return null
  }
  /**
   * Cancel deferred actions if input changed independently of the consumed second key.
   * @param value Current input value.
   * @returns No return value.
   */
  function changed(value: string): void {
    if (pendingText !== null && value !== pendingInputValue) cancel()
  }
  return { key, cancel, changed }
}
