export const FILE_USAGE_KEY = 'file-search-open-history'
export interface FileUsageEntry {
  path: string
  count: number
  lastOpened: number
  indexed?: boolean
}
export interface FileUsageDatabase {
  dbGet: (key: string) => unknown
  dbPut: (key: string, value: unknown) => unknown
}

/** Local-only, bounded successful-open history. No filesystem reads or background disk polling. */
export class FileUsageStore {
  /**
   * Bind the store to the application's device-scoped database or an isolated test adapter.
   * @param db Database adapter.
   * @returns A history store.
   */
  constructor(private readonly db: FileUsageDatabase) {}

  /**
   * Read and sanitize at most 500 recent entries.
   * @returns New entries, newest first.
   */
  read(): FileUsageEntry[] {
    const raw = this.db.dbGet(FILE_USAGE_KEY)
    const entries = new Map<string, FileUsageEntry>()
    if (Array.isArray(raw))
      for (const value of raw) {
        if (
          !value ||
          typeof value.path !== 'string' ||
          !Number.isFinite(value.count) ||
          !Number.isFinite(value.lastOpened) ||
          value.count < 1
        )
          continue
        const key = value.path.toLowerCase()
        const entry = {
          path: value.path,
          count: Math.min(Math.floor(value.count), 1_000_000),
          lastOpened: value.lastOpened,
          indexed: value.indexed === true
        }
        if (!entries.has(key) || entries.get(key)!.lastOpened < entry.lastOpened)
          entries.set(key, entry)
      }
    return [...entries.values()].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 500)
  }

  /**
   * Count a successful open, retaining only the most recently opened 500 paths.
   * @param target Opened absolute path.
   * @param indexed Whether Everything returned this path.
   * @param now Open time in Unix milliseconds.
   * @returns No return value.
   */
  record(target: string, indexed = false, now = Date.now()): void {
    const entries = this.read()
    const previous = entries.find((entry) => entry.path.toLowerCase() === target.toLowerCase())
    const next = entries.filter((entry) => entry.path.toLowerCase() !== target.toLowerCase())
    next.unshift({
      path: target,
      count: Math.min((previous?.count || 0) + 1, 1_000_000),
      lastOpened: now,
      indexed: indexed || previous?.indexed === true
    })
    this.db.dbPut(FILE_USAGE_KEY, next.slice(0, 500))
  }

  /**
   * Remove a confirmed missing path after a failed open.
   * @param target Missing path.
   * @returns No return value.
   */
  remove(target: string): void {
    const entries = this.read()
    const kept = entries.filter((entry) => entry.path.toLowerCase() !== target.toLowerCase())
    if (kept.length !== entries.length) this.db.dbPut(FILE_USAGE_KEY, kept)
  }

  /**
   * Drop index-confirmed missing entries without touching files on sleeping disks.
   * @param checked Paths actually checked in a successful index response.
   * @param existing Paths the index still contains.
   * @returns No return value.
   */
  prune(checked: string[], existing: string[]): void {
    const candidates = new Set(checked.map((value) => value.toLowerCase()))
    const present = new Set(existing.map((value) => value.toLowerCase()))
    const entries = this.read()
    const kept = entries.filter(
      (entry) => !candidates.has(entry.path.toLowerCase()) || present.has(entry.path.toLowerCase())
    )
    if (kept.length !== entries.length) this.db.dbPut(FILE_USAGE_KEY, kept)
  }

  /**
   * Erase only file-open history, leaving files and other preferences untouched.
   * @returns No return value.
   */
  clear(): void {
    this.db.dbPut(FILE_USAGE_KEY, [])
  }
}
