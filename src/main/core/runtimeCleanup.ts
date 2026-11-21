export interface RuntimeCleanupStep {
  name: string
  stop: () => void
}

/**
 * Build an idempotent shutdown barrier that releases every listener before windows or storage.
 * @param steps Ordered release operations, each independent of the others.
 * @param onError Error reporter which must not interrupt remaining releases.
 * @returns A synchronous, reentrant-safe cleanup function.
 */
export function createRuntimeCleanup(
  steps: RuntimeCleanupStep[],
  onError: (name: string, error: unknown) => void
): () => void {
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const step of steps) {
      try {
        step.stop()
      } catch (error) {
        // A failed native release must never skip the other threads.
        try {
          onError(step.name, error)
        } catch {
          // Logging may itself be unavailable late in shutdown.
        }
      }
    }
  }
}
