import {
  evaluateQuickTranslation,
  type QuickTranslationContext,
  type QuickTranslationReason
} from '../../../shared/quickTranslationPolicy'

export interface QuickTranslationResult {
  text: string
  error?: string
  phonetic?: string
  meanings?: string[]
  needsConfiguration?: boolean
}
export interface QuickTranslationState extends QuickTranslationResult {
  source: string
  status: 'idle' | 'loading' | 'success' | 'error'
  reason?: QuickTranslationReason
}
export interface QuickTranslationControllerOptions {
  translate: (
    text: string,
    options: { signal: AbortSignal; explicit: boolean }
  ) => Promise<QuickTranslationResult>
  onState: (state: QuickTranslationState) => void
  debounceMs?: number
  cacheSize?: number
}

/**
 * Manage debounced translation requests without depending on Vue, network clients or persistent storage.
 * @param options Injected adapter, state observer and bounded debounce/cache preferences.
 * @returns Input/configuration/cancellation lifecycle methods; all results stay in memory.
 */
export function createQuickTranslationController(options: QuickTranslationControllerOptions): {
  updateInput: (
    text: string,
    context: QuickTranslationContext,
    request?: { explicit?: boolean; pasted?: boolean }
  ) => void
  cancel: () => void
  invalidateConfiguration: () => void
  dispose: () => void
} {
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: AbortController | undefined
  let disposed = false
  let pendingSource: string | undefined
  const cache = new Map<string, QuickTranslationResult>()
  const capacity = Math.max(1, Math.min(100, options.cacheSize ?? 32))

  /**
   * Cancel pending work before changing input, including transitions to ineligible input.
   * @returns No return value.
   */
  function stop(): void {
    generation++
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    active?.abort()
    active = undefined
    pendingSource = undefined
  }

  /**
   * Clear active input results and cancel outstanding work.
   * @returns No return value.
   */
  function cancel(): void {
    stop()
    if (!disposed) options.onState({ source: '', text: '', status: 'idle' })
  }

  /**
   * Execute one current request and suppress responses from superseded or aborted generations.
   * @param source Normalized text approved by policy.
   * @param explicit Whether invoked by the explicit translation shortcut.
   * @param requestGeneration Generation captured when the request was scheduled.
   * @returns Completes when the adapter settles; failures appear as uncached error states.
   */
  async function run(source: string, explicit: boolean, requestGeneration: number): Promise<void> {
    if (disposed || generation !== requestGeneration) return
    const abort = new AbortController()
    active = abort
    options.onState({ source, text: '', status: 'loading' })
    try {
      const result = await options.translate(source, { signal: abort.signal, explicit })
      if (disposed || generation !== requestGeneration || abort.signal.aborted) return
      if (result.error || result.needsConfiguration || !result.text.trim()) {
        options.onState({
          ...result,
          source,
          status: 'error',
          error: result.error || '翻译暂不可用。'
        })
        return
      }
      // Keep only successful values, scoped to this controller and current configuration.
      cache.delete(source)
      cache.set(source, { ...result, meanings: result.meanings ? [...result.meanings] : undefined })
      while (cache.size > capacity) cache.delete(cache.keys().next().value!)
      options.onState({ ...result, source, status: 'success' })
    } catch {
      if (!disposed && generation === requestGeneration && !abort.signal.aborted)
        options.onState({ source, text: '', status: 'error', error: '翻译暂不可用，请稍后重试。' })
    } finally {
      if (active === abort) active = undefined
      if (generation === requestGeneration) pendingSource = undefined
    }
  }

  /**
   * Reassess input and debounce eligible automatic requests; explicit requests run immediately.
   * @param text Current input text.
   * @param context Current app matches and aliases, recomputed by the host.
   * @param request Optional explicit-shortcut marker.
   * @returns No return value.
   */
  function updateInput(
    text: string,
    context: QuickTranslationContext,
    request: { explicit?: boolean; pasted?: boolean } = {}
  ): void {
    if (disposed) return
    const decision = evaluateQuickTranslation(text, context, request)
    const source = decision.normalizedText
    // Repeated reactive updates for the same phrase must not restart an already issued request.
    if (decision.eligible && pendingSource === source && !(request.explicit && timer !== undefined))
      return
    stop()
    options.onState({ source, text: '', status: 'idle', reason: decision.reason })
    if (!decision.eligible) return
    const cached = cache.get(source)
    if (cached) {
      cache.delete(source)
      cache.set(source, cached)
      options.onState({
        ...cached,
        meanings: cached.meanings ? [...cached.meanings] : undefined,
        source,
        status: 'success'
      })
      return
    }
    const requestGeneration = generation
    pendingSource = source
    if (request.explicit) void run(source, true, requestGeneration)
    else
      timer = setTimeout(() => {
        timer = undefined
        void run(source, false, requestGeneration)
      }, options.debounceMs ?? 400)
  }

  /**
   * Invalidate cached translations and in-flight requests after provider/configuration changes.
   * @returns No return value; the host may resubmit current input with its fresh context.
   */
  function invalidateConfiguration(): void {
    cache.clear()
    cancel()
  }

  /**
   * Permanently release timers, requests and cached text without publishing further state.
   * @returns No return value.
   */
  function dispose(): void {
    disposed = true
    stop()
    cache.clear()
  }
  return { updateInput, cancel, invalidateConfiguration, dispose }
}
