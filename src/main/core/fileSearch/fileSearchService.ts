import { app } from 'electron'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { resolveEverythingIniPath } from './everythingClient'
import type { FileSearchResponse, FileSearchRequest } from '@shared/fileSearch'
import { normalizeHiddenPaths } from '@shared/searchHiddenPaths'

export interface FileSearchServiceOptions {
  workerPath?: string
}
interface PendingRequest {
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}
/**
 * Produce a non-throwing worker failure result.
 * @returns Empty unavailable response.
 */
const unavailable = (): FileSearchResponse => ({
  status: 'unavailable',
  items: [],
  total: 0,
  message: '文件搜索暂不可用，请稍后重试。'
})

/** The main process only handles small RPC messages; the worker owns all index data and scoring. */
export class FileSearchService {
  private worker: Worker | null = null
  private sequence = 0
  private pending = new Map<number, PendingRequest>()
  private channels = new Map<string, number>()
  /**
   * Configure the worker entry; tests supply a bundled source worker in their temporary directory.
   * @param options Optional internal worker location.
   * @returns A lazy service without starting threads or reading an index.
   */
  constructor(private readonly options: FileSearchServiceOptions = {}) {}

  /**
   * Issue a bounded request and cancel the previous request on the same renderer channel.
   * @param input Request payload; normalized fully inside the worker.
   * @returns Search response, or a cancellation/unavailability response without throwing.
   */
  public async search(input: unknown): Promise<FileSearchResponse> {
    const data = input && typeof input === 'object' ? (input as Partial<FileSearchRequest>) : {}
    const channel = typeof data.channel === 'string' ? data.channel.slice(0, 32) : 'default'
    const previous = this.channels.get(channel)
    if (previous !== undefined) this.settle(previous, { status: 'cancelled', items: [], total: 0 })
    const id = ++this.sequence
    this.channels.set(channel, id)
    try {
      // Bound structured-clone work before crossing the thread boundary; ignore unrelated fields.
      const payload = {
        query: typeof data.query === 'string' ? data.query.slice(0, 512) : '',
        mode: data.mode,
        types: Array.isArray(data.types) ? data.types.slice(0, 7) : [],
        sort: data.sort,
        direction: data.direction,
        limit: data.limit,
        deep: data.deep,
        phase: data.phase,
        channel,
        history: data.history,
        hiddenPaths: normalizeHiddenPaths(data.hiddenPaths),
        unavailableRoots: Array.isArray(data.unavailableRoots)
          ? data.unavailableRoots.slice(0, 32)
          : [],
        excludes: Array.isArray(data.excludes)
          ? data.excludes
              .slice(0, 100)
              .filter((value) => typeof value === 'string')
              .map((value) => value.slice(0, 4096))
          : []
      }
      return (await this.send(id, 'search', payload)) as FileSearchResponse
    } finally {
      if (this.channels.get(channel) === id) this.channels.delete(channel)
    }
  }

  /**
   * Warm the in-worker index without transporting any indexed names into the main process.
   * @returns Resolves when warm-up completes or fails harmlessly.
   */
  public async warmUp(): Promise<void> {
    await this.send(++this.sequence, 'warmUp')
  }

  /**
   * Verify history paths against the existing index, never against the physical files.
   * @param paths Bounded history paths.
   * @returns Existing paths or null on failure, which must not cause pruning.
   */
  public async existingPaths(paths: string[]): Promise<string[] | null> {
    const result = await this.send(++this.sequence, 'existingPaths', paths)
    return Array.isArray(result) ? result : null
  }

  /**
   * Remove an entry after an open failure; the worker excludes it until its next full refresh.
   * @param filePath Stale full path.
   * @returns Resolves when the worker applies the removal.
   */
  public async removePath(filePath: string): Promise<void> {
    await this.send(++this.sequence, 'removePath', filePath)
  }

  /**
   * Stop the thread and settle pending calls when the host or test shuts down.
   * @returns Resolves after the worker exits.
   */
  public async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = null
    for (const id of this.pending.keys()) this.settle(id, unavailable())
    this.channels.clear()
    if (worker) await worker.terminate()
  }

  /**
   * Resolve one pending call and release its deadline.
   * @param id RPC identifier.
   * @param result Worker response or local cancellation.
   * @returns No return value.
   */
  private settle(id: number, result: unknown): void {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(result)
  }

  /**
   * Start an isolated worker and attach bounded message/error handling.
   * @returns Active worker.
   */
  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(
      this.options.workerPath || path.join(app.getAppPath(), 'out', 'main', 'fileSearchWorker.js')
    )
    this.worker = worker
    worker.on('message', (message: { id: number; result: unknown }) =>
      this.settle(message.id, message.result)
    )
    /**
     * Settle callers on worker termination without retaining an unusable thread.
     * @returns No return value.
     */
    const fail = (): void => {
      if (this.worker !== worker) return
      this.worker = null
      for (const id of this.pending.keys()) this.settle(id, unavailable())
    }
    worker.on('error', fail)
    worker.on('exit', fail)
    worker.unref()
    return worker
  }

  /**
   * Send only query/configuration metadata; never transfer the full name index over this boundary.
   * @param id Request identifier.
   * @param action Supported worker operation.
   * @param payload Small operation payload.
   * @returns Response or a bounded failure result.
   */
  private send(id: number, action: string, payload?: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.settle(id, unavailable())
      }, 45_000)
      timer.unref()
      this.pending.set(id, { resolve, timer })
      try {
        this.getWorker().postMessage({
          id,
          action,
          payload,
          iniPath: resolveEverythingIniPath(),
          explicitIni: Boolean(
            process.env.ZTOOLS_EVERYTHING_INI ||
            process.env.VITEST ||
            process.env.ZTOOLS_E2E === '1' ||
            process.env.ZTOOLS_BACKGROUND_TEST === '1'
          )
        })
      } catch {
        this.settle(id, unavailable())
      }
    })
  }
}
export default new FileSearchService()
