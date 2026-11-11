import { ipcMain, shell } from 'electron'
import path from 'path'
import { normalizeFileSearchSettings } from '@shared/fileSearch'
import { isBackgroundTest } from '../../core/backgroundTestMode'
import fileSearchService from '../../core/fileSearch/fileSearchService'
import databaseAPI from '../shared/database'

/**
 * 硬盘文件搜索 API - 主程序专用。
 * 查询本机 Everything 索引，并打开文件或其所在文件夹。
 */
export class FileSearchAPI {
  private mainWindow: Electron.BrowserWindow | null = null

  /**
   * Register the IPC handlers and warm the index up shortly after start.
   * @param mainWindow Main search window; only it may search or open files.
   * @returns No return value.
   */
  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
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
      return fileSearchService.search(request)
    })
    ipcMain.handle('file-search:open', async (event, target: unknown, reveal?: unknown) => {
      if (event.sender.id !== this.mainWindow?.webContents.id)
        throw new Error('Invalid file search sender')
      return this.open(target, reveal === true)
    })
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
    if (reveal) {
      shell.showItemInFolder(target)
    } else {
      const error = await shell.openPath(target)
      if (error) return { success: false, error: '打不开，文件可能已被移动或删除' }
    }
    // Same as launching an app: reset the search box and get out of the way.
    this.mainWindow?.webContents.send('app-launched')
    this.mainWindow?.hide()
    return { success: true }
  }
}

export default new FileSearchAPI()
