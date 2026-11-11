import {
  buildEverythingQueries,
  fileCategory,
  hasChinese,
  prepareFileName,
  type PreparedFileName,
  isExcludedPath,
  isFuzzyScore,
  MATCH_SCORE,
  normalizeFileSearchViewState,
  parseFileQuery,
  scoreFileName,
  sortFileResults,
  type FileSearchItem,
  type FileSearchRequest,
  type FileSearchResponse
} from '@shared/fileSearch'
import {
  loadEverythingEndpoint,
  queryEverything,
  startEverythingInBackground,
  type EverythingEndpoint,
  type EverythingRawItem
} from './everythingClient'

/** Chinese-named items are re-read from the index at most this often. */
const NAME_INDEX_MAX_AGE_MS = 45 * 60 * 1000
/** An empty index (Everything still loading) is retried sooner. */
const EMPTY_INDEX_RETRY_MS = 30 * 1000
const NAME_INDEX_LIMIT = 300_000
const UNAVAILABLE_MESSAGE =
  '没有连接到 Everything。请确认 Everything 已安装并在运行，且已打开只限本机的查询口。'

/**
 * Join a parent folder and a name the way Windows shows them.
 * @param dir Parent folder path.
 * @param name File or folder name.
 * @returns Full path.
 */
function joinPath(dir: string, name: string): string {
  return dir ? (dir.endsWith('\\') ? dir + name : dir + '\\' + name) : name
}

/**
 * Disk file search backed by a local Everything instance, plus an in-memory list of
 * Chinese-named items used for pinyin, inserted-character and wrong-character matching.
 */
export class FileSearchEngine {
  private nameIndex = new Map<string, EverythingRawItem & { prepared: PreparedFileName }>()
  private lastDeltaAt = 0
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private removedPaths = new Set<string>()
  private nameIndexBuiltAt = 0
  private nameIndexBuilding: Promise<void> | null = null
  private readonly channels = new Map<string, AbortController>()
  /** Time of the last successful answer; a recent one skips the connection probe. */
  private lastAnswerAt = 0

  /**
   * Search files and folders by name.
   * @param input Untrusted request from the renderer.
   * @returns Ranked items, or why the search could not run. Never throws.
   */
  public async search(input: unknown): Promise<FileSearchResponse> {
    const request = this.normalizeRequest(input)
    // Even an empty or invalid replacement makes the previous query on this channel obsolete.
    const channel = request.channel || 'default'
    this.channels.get(channel)?.abort()
    const parsed = parseFileQuery(request.query)
    if (parsed.kind === 'empty') return { status: 'ok', items: [], total: 0 }
    if (parsed.kind === 'invalid')
      return { status: 'invalid', items: [], total: 0, message: parsed.message }

    // Track this request so a newer input can stop its outstanding index queries.
    const controller = new AbortController()
    this.channels.set(channel, controller)
    try {
      const endpoint = await this.connect(controller.signal)
      if (controller.signal.aborted) return { status: 'cancelled', items: [], total: 0 }
      if (!endpoint)
        return { status: 'unavailable', items: [], total: 0, message: UNAVAILABLE_MESSAGE }

      const fuzzy =
        request.phase !== 'literal' && request.mode === 'fuzzy' && parsed.kind === 'terms'
      const queries = buildEverythingQueries(
        parsed,
        request.phase === 'literal' ? { ...request, deep: false } : request
      )
      // The literal query is mandatory; the helper tiers may fail without failing the search.
      const [results] = await Promise.all([
        Promise.all(
          queries.map((query) =>
            queryEverything(endpoint, query, controller.signal).catch((error) => {
              if (query.id === 'contains' || query.id === 'regex') throw error
              return { total: 0, items: [] }
            })
          )
        ),
        fuzzy ? this.ensureNameIndex(endpoint).catch(() => {}) : Promise.resolve()
      ])
      if (controller.signal.aborted) return { status: 'cancelled', items: [], total: 0 }
      this.lastAnswerAt = Date.now()

      const terms = parsed.kind === 'terms' ? parsed.terms : []
      const found = new Map<string, FileSearchItem>()
      /**
       * Score and keep one candidate unless it is excluded or already present.
       * @param raw Item returned by the index.
       * @param literal Whether the index matched it literally (kept even if rescoring disagrees).
       * @returns No return value.
       */
      const add = (
        raw: EverythingRawItem & { prepared?: PreparedFileName },
        literal: boolean
      ): void => {
        const fullPath = joinPath(raw.dir, raw.name)
        const key = fullPath.toLowerCase()
        if (
          found.has(key) ||
          this.removedPaths.has(key) ||
          isExcludedPath(fullPath, request.excludes) ||
          (request.unavailableRoots || []).some((root) => key.startsWith(root.toLowerCase()))
        )
          return
        const candidate = { name: raw.name, path: fullPath, isFolder: raw.isFolder }
        const score =
          parsed.kind === 'regex'
            ? MATCH_SCORE.contains * 1000
            : (scoreFileName(candidate, terms, fuzzy, raw.prepared) ??
              (literal ? MATCH_SCORE.contains * 1000 + 999 : null))
        if (score === null) return
        found.set(key, {
          ...candidate,
          dir: raw.dir,
          size: raw.size,
          modified: raw.modified,
          score
        })
      }
      queries.forEach((query, index) => {
        const literal = query.id !== 'gap' && query.id !== 'typo'
        for (const raw of results[index].items) add(raw, literal)
      })
      if (fuzzy) {
        // Pinyin, inserted and wrong characters for Chinese names are matched in memory.
        let scanned = 0
        for (const raw of this.nameIndex.values()) {
          if (++scanned % 512 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve))
            if (controller.signal.aborted) return { status: 'cancelled', items: [], total: 0 }
          }
          const category = fileCategory(raw.name, raw.isFolder)
          if (request.types.length && (category === 'other' || !request.types.includes(category)))
            continue
          add(raw, false)
        }
      }

      const items = [...found.values()]
      const literalTotal = Math.max(
        results[queries.findIndex((query) => query.id === 'contains' || query.id === 'regex')]
          ?.total ?? 0,
        items.filter((item) => !isFuzzyScore(item.score)).length
      )
      return {
        status: 'ok',
        items: sortFileResults(items, request.sort, request.history, request.direction).slice(
          0,
          request.limit
        ),
        total: literalTotal + items.filter((item) => isFuzzyScore(item.score)).length
      }
    } catch {
      if (controller.signal.aborted) return { status: 'cancelled', items: [], total: 0 }
      // Probe (and if needed start Everything) again on the next search.
      this.lastAnswerAt = 0
      return { status: 'unavailable', items: [], total: 0, message: UNAVAILABLE_MESSAGE }
    } finally {
      if (this.channels.get(channel) === controller) this.channels.delete(channel)
    }
  }

  /**
   * Start Everything if needed and load the Chinese name list ahead of the first search.
   * @returns Completes when the warm-up finished or was skipped. Never throws.
   */
  public async warmUp(): Promise<void> {
    try {
      const endpoint = await this.connect()
      if (endpoint) await this.ensureNameIndex(endpoint)
    } catch {
      // Warm-up is best effort; the first real search reports problems to the user.
    }
  }

  /**
   * Coerce an IPC payload into a bounded request.
   * @param input Untrusted payload.
   * @returns Request with validated mode, filters, limit and exclusions.
   */
  private normalizeRequest(input: unknown): FileSearchRequest {
    const data = (input && typeof input === 'object' ? input : {}) as Partial<FileSearchRequest>
    const limit = Number(data.limit)
    return {
      ...normalizeFileSearchViewState(data),
      query: typeof data.query === 'string' ? data.query.slice(0, 512) : '',
      limit: Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 500) : 50,
      deep: data.deep === true,
      phase: data.phase === 'literal' ? 'literal' : 'fuzzy',
      history: data.history,
      unavailableRoots: data.unavailableRoots,
      channel: typeof data.channel === 'string' ? data.channel.slice(0, 32) : undefined,
      excludes: Array.isArray(data.excludes)
        ? data.excludes
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.replace(/"/g, '').trim())
            .filter(Boolean)
            .slice(0, 100)
        : []
    }
  }

  /**
   * Resolve the endpoint and make sure Everything answers, starting it once when it is not running.
   * @param signal Cancels the wait.
   * @returns Working endpoint, or null when Everything is not set up or cannot be reached.
   */
  private async connect(signal?: AbortSignal): Promise<EverythingEndpoint | null> {
    const endpoint = await loadEverythingEndpoint()
    if (!endpoint) return null
    if (Date.now() - this.lastAnswerAt < 15_000) return endpoint
    const probe = { search: 'wfn:"ztools-connection-probe"', count: 1, recentFirst: false }
    try {
      await queryEverything(endpoint, probe, signal, 3000)
      this.lastAnswerAt = Date.now()
      return endpoint
    } catch (error) {
      // Only a refused connection means "not running"; wrong credentials must not launch anything.
      if ((error as NodeJS.ErrnoException)?.code !== 'ECONNREFUSED') return null
      if (!startEverythingInBackground()) return null
    }
    for (let attempt = 0; attempt < 10 && !signal?.aborted; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      try {
        await queryEverything(endpoint, probe, signal, 3000)
        this.lastAnswerAt = Date.now()
        return endpoint
      } catch {
        // Keep waiting while Everything starts up.
      }
    }
    return null
  }

  /**
   * Check a bounded list against the index without touching individual files or waking their disks.
   * @param paths Full indexed paths to verify.
   * @returns Existing paths, or null when index availability is uncertain.
   */
  public async existingPaths(paths: string[]): Promise<string[] | null> {
    try {
      const endpoint = await this.connect()
      if (!endpoint) return null
      const safe = [
        ...new Set(
          paths.filter(
            (value) => typeof value === 'string' && value.length < 4096 && !/["|\r\n]/.test(value)
          )
        )
      ].slice(0, 500)
      const found: string[] = []
      for (let offset = 0; offset < safe.length; offset += 40) {
        const batch = safe.slice(offset, offset + 40)
        const result = await queryEverything(endpoint, {
          search: `filelist:"${batch.join('|')}"`,
          count: batch.length,
          recentFirst: false
        })
        found.push(...result.items.map((item) => joinPath(item.dir, item.name)))
      }
      return found
    } catch {
      return null
    }
  }

  /**
   * Remove a failed-open path immediately until the next complete index rebuild.
   * @param filePath Full stale path supplied by the trusted host.
   * @returns No return value.
   */
  public removePath(filePath: string): void {
    const key = filePath.toLowerCase()
    this.nameIndex.delete(key)
    this.removedPaths.add(key)
  }

  /**
   * Release scheduled refresh and cancel outstanding queries when the worker shuts down.
   * @returns No return value.
   */
  public dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    for (const controller of this.channels.values()) controller.abort()
    this.channels.clear()
  }

  /**
   * Refresh in-worker metadata by modification/creation time, with a periodic complete replacement.
   * @param endpoint Authenticated loopback endpoint.
   * @param forceFull Whether to bypass the normal full-refresh interval.
   * @param now Timestamp used for overlap and testable refresh scheduling.
   * @returns Resolves after refresh; failed snapshots never erase the old index.
   */
  public async refreshIndex(
    endpoint: EverythingEndpoint,
    forceFull = false,
    now = Date.now()
  ): Promise<void> {
    if (this.nameIndexBuilding) return this.nameIndexBuilding
    const full =
      forceFull || !this.nameIndexBuiltAt || now - this.nameIndexBuiltAt >= NAME_INDEX_MAX_AGE_MS
    if (!full && now - this.lastDeltaAt < 60_000) return
    const timestamp = new Date((this.lastDeltaAt || now) - 120_000)
    // Everything dates without a timezone use local time. Preserve a two-minute overlap.
    const localDate = new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 19)
    // Unindexed dc: may trigger physical file metadata reads; never use it without explicit index support.
    const delta = endpoint.dateCreatedIndexed
      ? `<dm:${localDate}..|dc:${localDate}..>`
      : `dm:${localDate}..`
    const search = full ? 'regex:[㐀-鿿]' : `regex:[㐀-鿿] ${delta}`
    this.nameIndexBuilding = (async () => {
      const result = await queryEverything(
        endpoint,
        { search, count: NAME_INDEX_LIMIT, recentFirst: false },
        undefined,
        30_000
      )
      if (result.total > result.items.length) throw new Error('Chinese index response truncated')
      const next = full
        ? new Map<string, EverythingRawItem & { prepared: PreparedFileName }>()
        : this.nameIndex
      let preparedCount = 0
      for (const item of result.items) {
        if (!hasChinese(item.name)) continue
        const key = joinPath(item.dir, item.name).toLowerCase()
        if (!full && this.removedPaths.has(key)) continue
        next.set(key, {
          ...item,
          prepared: prepareFileName({
            name: item.name,
            path: joinPath(item.dir, item.name),
            isFolder: item.isFolder
          })
        })
        if (++preparedCount % 512 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      }
      this.nameIndex = next
      if (full) {
        this.nameIndexBuiltAt = now
        this.removedPaths.clear()
      }
      this.lastDeltaAt = now
    })().finally(() => {
      this.nameIndexBuilding = null
    })
    return this.nameIndexBuilding
  }

  /**
   * Ensure a usable worker-owned index and start the sixty-second refresh schedule.
   * @param endpoint Authenticated loopback endpoint.
   * @returns Resolves when the first full snapshot or required refresh has completed.
   */
  private async ensureNameIndex(endpoint: EverythingEndpoint): Promise<void> {
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        void loadEverythingEndpoint()
          .then((current) => (current ? this.refreshIndex(current) : undefined))
          .catch(() => {})
      }, 60_000)
      this.refreshTimer.unref()
    }
    if (!this.nameIndexBuiltAt) await this.refreshIndex(endpoint)
    else if (
      Date.now() - this.lastDeltaAt >=
      (this.nameIndex.size ? 60_000 : EMPTY_INDEX_RETRY_MS)
    ) {
      void this.refreshIndex(endpoint).catch(() => {})
    }
  }
}
