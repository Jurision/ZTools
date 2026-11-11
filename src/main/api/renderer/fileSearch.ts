import { ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'path'
import {
  directFilePath,
  normalizeFileSearchSettings,
  type FileSearchRequest,
  type FileSearchResponse
} from '@shared/fileSearch'
import { isBackgroundTest } from '../../core/backgroundTestMode'
import fileSearchService from '../../core/fileSearch/fileSearchService'
import databaseAPI from '../shared/database'
import { FileUsageStore } from '../../core/fileSearch/fileUsageStore'
import {
  VolumeAvailability,
  isUnavailablePath,
  readMountedRoots
} from '../../core/fileSearch/volumeAvailability'

export const fileUsageStore = new FileUsageStore(databaseAPI)

/**
 * 硬盘文件搜索 API - 主程序专用。
 * 查询本机 Everything 索引，并打开文件或其所在文件夹。
 */
export class FileSearchAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private readonly volumes = new VolumeAvailability(() =>
    isBackgroundTest() || process.env.ZTOOLS_E2E === '1'
      ? Promise.resolve(null)
      : readMountedRoots()
  )
  private readonly indexedResults = new Set<string>()
  private readonly sequences = new Map<string, number>()
  private historyCheckedAt = 0

  /**
   * Register the IPC handlers and warm the index up shortly after start.
   * @param mainWindow Main search window; only it may search or open files.
   * @returns No return value.
   */
  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
    if (process.platform === 'win32' && !isBackgroundTest() && process.env.ZTOOLS_E2E !== '1') {
      mainWindow.hookWindowMessage(0x0219, () => {
        // Device changes invalidate the OS mount table; no directory or sleeping-disk scan.
        this.volumes.invalidate()
        mainWindow.webContents.send('file-search-refresh')
      })
    }
    // Starting Everything early also keeps other tools from launching their own elevated copy.
    if (!isBackgroundTest() && process.env.ZTOOLS_E2E !== '1') {
      setTimeout(() => {
        const settings = normalizeFileSearchSettings(
          databaseAPI.dbGet('settings-general')?.fileSearch
        )
        if (settings.enabled) void fileSearchService.warmUp()
      }, 5000)
    }
  }

  /**
   * Bind file-search channels to the main window only.
   * @returns No return value.
   */
  private setupIPC(): void {
    ipcMain.handle('file-search:query', async (event, request: unknown) => {
      if (event.sender.id !== this.mainWindow?.webContents.id)
        throw new Error('Invalid file search sender')
      return this.search(request)
    })
    ipcMain.handle('file-search:open', async (event, target: unknown, reveal?: unknown) => {
      if (event.sender.id !== this.mainWindow?.webContents.id)
        throw new Error('Invalid file search sender')
      return this.open(target, reveal === true)
    })
  }

  /**
   * Attach device-local history and online-volume state, then resolve an explicitly pasted path.
   * @param input Renderer query; internal history/volume fields are always overwritten.
   * @returns Latest result set, with an existing explicit target first.
   */
  private async search(input: unknown): Promise<FileSearchResponse> {
    const request = (input && typeof input === 'object' ? input : {}) as Partial<FileSearchRequest>
    const channel = typeof request.channel === 'string' ? request.channel.slice(0, 32) : 'default'
    const sequence = (this.sequences.get(channel) || 0) + 1
    this.sequences.set(channel, sequence)
    const unavailableRoots = await this.volumes.unavailable()
    if (this.sequences.get(channel) !== sequence)
      return { status: 'cancelled', items: [], total: 0 }
    const history = Object.fromEntries(
      fileUsageStore.read().map((entry) => [entry.path.toLowerCase(), entry])
    )
    const result = await fileSearchService.search({ ...request, history, unavailableRoots })
    if (this.sequences.get(channel) !== sequence)
      return { status: 'cancelled', items: [], total: 0 }
    if (result.status === 'ok') {
      for (const item of result.items) this.indexedResults.add(item.path.toLowerCase())
      while (this.indexedResults.size > 2000)
        this.indexedResults.delete(this.indexedResults.values().next().value!)
      this.pruneHistory(unavailableRoots)
    }
    const direct = directFilePath(typeof request.query === 'string' ? request.query : '')
    const testing = isBackgroundTest() || process.env.ZTOOLS_E2E === '1'
    const testRoot = process.env.ZTOOLS_DATA_ROOT
    const relative =
      testRoot && direct ? path.relative(path.resolve(testRoot), path.resolve(direct)) : undefined
    const mayStat =
      !testing ||
      (relative !== undefined &&
        !path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith('..' + path.sep))
    if (direct && mayStat && !isUnavailablePath(direct, unavailableRoots)) {
      try {
        // This one filesystem read is caused by an explicit path paste/query, not index polling.
        const info = await fs.stat(direct)
        if (this.sequences.get(channel) !== sequence)
          return { status: 'cancelled', items: [], total: 0 }
        const rest = result.items.filter((item) => item.path.toLowerCase() !== direct.toLowerCase())
        result.status = 'ok'
        result.message = undefined
        result.items = [
          {
            path: direct,
            name: path.basename(direct),
            dir: path.dirname(direct),
            isFolder: info.isDirectory(),
            size: info.size,
            modified: info.mtimeMs,
            score: -1
          },
          ...rest
        ].slice(0, Number.isFinite(request.limit) ? Math.max(1, Math.min(request.limit!, 500)) : 50)
        result.total = Math.max(result.total, result.items.length)
      } catch {
        /* Index results remain useful for a path fragment or a moved target. */
      }
    }
    if (this.sequences.get(channel) !== sequence)
      return { status: 'cancelled', items: [], total: 0 }
    return result
  }

  /**
   * Validate only formerly indexed history against the index, preserving unplugged disks.
   * @param unavailableRoots Drive roots not currently mounted.
   * @returns No return value; pruning runs in the background at most every five minutes.
   */
  private pruneHistory(unavailableRoots: string[]): void {
    if (Date.now() - this.historyCheckedAt < 300_000) return
    this.historyCheckedAt = Date.now()
    const checked = fileUsageStore
      .read()
      .filter((entry) => entry.indexed && !isUnavailablePath(entry.path, unavailableRoots))
      .map((entry) => entry.path)
    if (!checked.length) return
    void fileSearchService
      .existingPaths(checked)
      .then(async (existing) => {
        if (existing !== null) {
          this.volumes.invalidate()
          const offlineNow = await this.volumes.unavailable()
          fileUsageStore.prune(
            checked.filter((target) => !isUnavailablePath(target, offlineNow)),
            existing
          )
        }
      })
      .catch(() => {})
  }

  /**
   * Open a found file or folder, or show it selected in its parent folder.
   * @param target Absolute path from a search result.
   * @param reveal True to open the containing folder with the item selected.
   * @returns Whether the item was opened, with a readable reason on failure.
   */
  private async open(
    target: unknown,
    reveal: boolean
  ): Promise<{ success: boolean; error?: string }> {
    // Only absolute local paths are accepted; nothing is interpreted as a command or URL.
    if (typeof target !== 'string' || !path.isAbsolute(target) || target.length > 4096)
      return { success: false, error: '路径无效' }
    this.volumes.invalidate()
    if (isUnavailablePath(target, await this.volumes.unavailable())) {
      this.mainWindow?.webContents.send('file-search-refresh')
      return { success: false, error: '盘不在，已隐藏该盘结果' }
    }
    try {
      await fs.stat(target)
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) {
        fileUsageStore.remove(target)
        await fileSearchService.removePath(target)
        this.mainWindow?.webContents.send('file-search-refresh')
      }
      return { success: false, error: '打不开，文件可能已被移动或删除' }
    }
    if (reveal) {
      shell.showItemInFolder(target)
    } else {
      const error = await shell.openPath(target)
      if (error) return { success: false, error: '打不开，文件可能已被移动或删除' }
    }
    fileUsageStore.record(target, this.indexedResults.has(target.toLowerCase()))
    // Same as launching an app: reset the search box and get out of the way.
    this.mainWindow?.webContents.send('app-launched')
    this.mainWindow?.hide()
    return { success: true }
  }
}

export default new FileSearchAPI()
