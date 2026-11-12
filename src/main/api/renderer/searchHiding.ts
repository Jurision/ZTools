import { ipcMain, type BrowserWindow } from 'electron'
import databaseAPI from '../shared/database'
import { normalizeSearchSources } from '@shared/searchSources'
import { normalizeFileSearchSettings } from '@shared/fileSearch'
import { normalizeHiddenPaths } from '@shared/searchHiddenPaths'

/**
 * Register host-only search exclusions, merging synchronously with the latest settings.
 * @param mainWindow Trusted launcher renderer.
 * @returns No return value.
 */
export function registerSearchHiding(mainWindow: BrowserWindow): void {
  ipcMain.handle('search:hide-result', (event, kind: unknown, targets: unknown) => {
    if (event.sender.id !== mainWindow.webContents.id) throw new Error('Invalid search sender')
    if (kind !== 'app' && kind !== 'file') throw new Error('Invalid search result kind')
    const paths = normalizeHiddenPaths(targets)
    if (!paths.length || paths.length > 2) throw new Error('Invalid search targets')
    // Write before notifying: failed persistence must never falsely remove a result from the UI.
    const existing = databaseAPI.dbGet('settings-general') || {}
    if (kind === 'app') {
      const searchSources = normalizeSearchSources(existing.searchSources)
      searchSources.hiddenApplicationPaths = normalizeHiddenPaths([
        ...paths,
        ...(searchSources.hiddenApplicationPaths || [])
      ])
      databaseAPI.dbPut('settings-general', { ...existing, searchSources })
      mainWindow.webContents.send('update-search-sources', searchSources)
    } else {
      const fileSearch = normalizeFileSearchSettings(existing.fileSearch)
      fileSearch.hiddenPaths = normalizeHiddenPaths([...paths, ...(fileSearch.hiddenPaths || [])])
      databaseAPI.dbPut('settings-general', { ...existing, fileSearch })
      mainWindow.webContents.send('update-file-search-settings', fileSearch)
    }
    return { success: true }
  })
}
