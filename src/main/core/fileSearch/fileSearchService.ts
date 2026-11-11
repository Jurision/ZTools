import {
  buildEverythingQueries,
  fileCategory,
  hasChinese,
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
const NAME_INDEX_MAX_AGE_MS = 10 * 60 * 1000
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
export class FileSearchService {
  private nameIndex: EverythingRawItem[] = []
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
    const parsed = parseFileQuery(request.query)
    if (parsed.kind === 'empty') return { status: 'ok', items: [], total: 0 }
    if (parsed.kind === 'invalid')
      return { status: 'invalid', items: [], total: 0, message: parsed.message }

    // A newer request on the same channel makes the older one pointless; stop its slow queries.
    const channel = request.channel || 'default'
    this.channels.get(channel)?.abort()
    const controller = new AbortController()
    this.channels.set(channel, controller)
    try {
      const endpoint = await this.connect(controller.signal)
      if (!endpoint)
        return { status: 'unavailable', items: [], total: 0, message: UNAVAILABLE_MESSAGE }

      const fuzzy = request.mode === 'fuzzy' && parsed.kind === 'terms'
      const queries = buildEverythingQueries(parsed, request)
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
        fuzzy ? this.ensureNameIndex(endpoint) : Promise.resolve()
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
      const add = (raw: EverythingRawItem, literal: boolean): void => {
        const fullPath = joinPath(raw.dir, raw.name)
        const key = fullPath.toLowerCase()
        if (found.has(key) || isExcludedPath(fullPath, request.excludes)) return
        const candidate = { name: raw.name, path: fullPath, isFolder: raw.isFolder }
        const score =
          parsed.kind === 'regex'
            ? MATCH_SCORE.contains * 1000
            : (scoreFileName(candidate, terms, fuzzy) ??
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
        for (const raw of this.nameIndex) {
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
        items: sortFileResults(items, request.sort).slice(0, request.limit),
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
   * Keep the in-memory list of Chinese-named items reasonably fresh. A stale list is refreshed in
   * the background; only a missing list is waited for, and only briefly.
   * @param endpoint Working endpoint.
   * @returns Completes when a usable list is available or the short wait elapsed.
   */
  private async ensureNameIndex(endpoint: EverythingEndpoint): Promise<void> {
    const maxAge = this.nameIndex.length ? NAME_INDEX_MAX_AGE_MS : EMPTY_INDEX_RETRY_MS
    if (this.nameIndexBuiltAt && Date.now() - this.nameIndexBuiltAt < maxAge) return
    if (!this.nameIndexBuilding) {
      this.nameIndexBuilding = queryEverything(
        endpoint,
        { search: 'regex:[㐀-鿿]', count: NAME_INDEX_LIMIT, recentFirst: false },
        undefined,
        30_000
      )
        .then((result) => {
          this.nameIndex = result.items.filter((item) => hasChinese(item.name))
          this.nameIndexBuiltAt = Date.now()
        })
        .catch(() => {
          // Keep the previous list; the next search tries again.
        })
        .finally(() => {
          this.nameIndexBuilding = null
        })
    }
    if (this.nameIndexBuiltAt) return
    await Promise.race([
      this.nameIndexBuilding,
      new Promise((resolve) => setTimeout(resolve, 2500))
    ])
  }
}

export default new FileSearchService()
