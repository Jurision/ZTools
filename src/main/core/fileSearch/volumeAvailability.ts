import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
/**
 * Query Windows' mounted drive-letter table, without opening any file or enumerating disk contents.
 * @returns Mounted drive roots; null means the snapshot could not be obtained.
 */
export async function readMountedRoots(): Promise<string[] | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execute(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Environment]::GetLogicalDrives() | ConvertTo-Json -Compress'
      ],
      { windowsHide: true, timeout: 3000, maxBuffer: 4096 }
    )
    const raw = JSON.parse(stdout.trim())
    const values = Array.isArray(raw) ? raw : [raw]
    return values.filter(
      (value): value is string => typeof value === 'string' && /^[a-z]:\\$/i.test(value)
    )
  } catch {
    return null
  }
}

/** Cached mounted-volume availability; only queried on search/open or a device-change notification. */
export class VolumeAvailability {
  private snapshot: string[] | null = null
  private checkedAt = 0
  private generation = 0
  private pending: Promise<string[]> | null = null
  /**
   * Use an injected OS reader for isolated tests.
   * @param read Mounted-volume snapshot reader.
   * @returns An availability cache.
   */
  constructor(private readonly read: () => Promise<string[] | null> = readMountedRoots) {}
  /**
   * Invalidate the snapshot on WM_DEVICECHANGE.
   * @returns No return value.
   */
  invalidate(): void {
    this.generation++
    this.checkedAt = 0
  }
  /**
   * Return unavailable drive letters using the OS mount table, never per-file stat polling.
   * @returns Unavailable roots. On initial OS failure returns none rather than hiding every disk.
   */
  async unavailable(): Promise<string[]> {
    if (this.checkedAt && Date.now() - this.checkedAt < 5000) return this.missing()
    if (!this.pending) {
      this.pending = (async () => {
        let generation: number
        do {
          generation = this.generation
          const roots = await this.read().catch(() => null)
          if (roots !== null && generation === this.generation)
            this.snapshot = roots.map((root) => root.toLowerCase())
        } while (generation !== this.generation)
        this.checkedAt = Date.now()
        return this.missing()
      })().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }
  /**
   * Compute absent letters from the last known mount table.
   * @returns Missing roots.
   */
  private missing(): string[] {
    if (!this.snapshot) return []
    return Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i) + ':\\').filter(
      (root) => !this.snapshot!.includes(root)
    )
  }
}

/**
 * Determine whether a result belongs to an unavailable mounted-letter root.
 * @param target Absolute path.
 * @param roots Unavailable roots from the OS table.
 * @returns True for offline drive-letter paths; UNC paths are not guessed offline.
 */
export function isUnavailablePath(target: string, roots: string[]): boolean {
  return roots.some((root) =>
    target.toLowerCase().replace(/\//g, '\\').startsWith(root.toLowerCase())
  )
}
