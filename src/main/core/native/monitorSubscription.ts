/** Own one native callback generation so stopped or replaced listeners cannot call consumers. */
export class MonitorSubscription<Args extends unknown[] = [], Result = void> {
  private token: object | null = null
  private stopDriver: (() => void) | null = null
  private releasing = false

  /**
   * Report whether this subscription still accepts native callbacks.
   * @returns True while a generation is active.
   */
  get active(): boolean {
    return this.token !== null
  }

  /**
   * Start a generation and unwind partially acquired native resources on failure.
   * @param callback Consumer of current-generation events.
   * @param startDriver Native registration accepting a guarded callback.
   * @param stopDriver Native release operation.
   * @returns No value.
   * @throws If already active or native registration fails.
   */
  start(
    callback: (...args: Args) => Result,
    startDriver: (dispatch: (...args: Args) => Result | undefined) => void,
    stopDriver: () => void
  ): void {
    if (this.active) throw new Error('Monitor is already running')
    if (this.stopDriver) throw new Error('Previous native listener release did not complete')
    if (typeof callback !== 'function') throw new TypeError('Callback must be a function')
    const token = {}
    this.token = token
    this.stopDriver = stopDriver
    try {
      startDriver((...args) => (this.token === token ? callback(...args) : undefined))
    } catch (error) {
      // Invalidate first: a native stop can synchronously drain pending events.
      try {
        this.stop()
      } catch (stopError) {
        console.error('[NativeMonitor] Partial start cleanup failed:', stopError)
      }
      throw error
    }
  }

  /**
   * Invalidate pending callbacks before releasing the native thread; safe to call twice.
   * @returns No value.
   * @throws If the native release operation fails.
   */
  stop(): void {
    const stopDriver = this.stopDriver
    this.token = null
    if (!stopDriver || this.releasing) return
    this.releasing = true
    try {
      stopDriver()
      this.stopDriver = null
    } finally {
      // A throwing release leaves ownership uncertain. Never overwrite a possibly joinable thread.
      this.releasing = false
    }
  }
}
