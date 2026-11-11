import type { FileSearchItem } from '@shared/fileSearch'
import { ref, type Ref } from 'vue'

interface FileActions {
  /** Path of the row showing a short note, and the note itself. */
  notice: Ref<{ path: string; text: string } | null>
  openFile: (item: FileSearchItem, reveal?: boolean) => Promise<void>
  copyPath: (item: FileSearchItem) => Promise<void>
  showMenu: (item: FileSearchItem) => Promise<void>
  handleMenuCommand: (command: string) => Promise<boolean>
  clearNotice: () => void
}

/**
 * Actions shared by file rows in the main search box and on the file search page.
 * @returns Open, reveal, copy-path and context-menu helpers plus a per-row notice.
 */
export function useFileActions(): FileActions {
  const notice = ref<{ path: string; text: string } | null>(null)

  /**
   * Open a file or folder, or show it selected in its parent folder.
   * @param item Search result.
   * @param reveal True to open the containing folder instead.
   * @returns Completes after the request; failures are shown on the row.
   */
  async function openFile(item: FileSearchItem, reveal = false): Promise<void> {
    try {
      const result = await window.ztools.openFoundFile(item.path, reveal)
      notice.value = result.success ? null : { path: item.path, text: result.error || '打不开' }
    } catch {
      notice.value = { path: item.path, text: '打不开' }
    }
  }

  /**
   * Copy the full path of a result to the clipboard.
   * @param item Search result.
   * @returns Completes after the clipboard write.
   */
  async function copyPath(item: FileSearchItem): Promise<void> {
    try {
      await window.ztools.copyToClipboard(item.path)
      notice.value = { path: item.path, text: '已复制路径' }
    } catch {
      notice.value = { path: item.path, text: '复制失败' }
    }
  }

  /**
   * Show the right-click menu of a file row.
   * @param item Search result.
   * @returns Completes after the menu was requested.
   */
  async function showMenu(item: FileSearchItem): Promise<void> {
    const payload = JSON.stringify({ path: item.path })
    await window.ztools.showContextMenu([
      { id: `file-open:${payload}`, label: '打开' },
      { id: `file-reveal:${payload}`, label: '打开所在文件夹' },
      { id: `file-copy-path:${payload}`, label: '复制路径' }
    ])
  }

  /**
   * Run a file-row menu command returned by the main process.
   * @param command Menu command id with its JSON payload.
   * @returns True when the command belonged to a file row and was handled.
   */
  async function handleMenuCommand(command: string): Promise<boolean> {
    const match = /^file-(open|reveal|copy-path):(.*)$/s.exec(command)
    if (!match) return false
    try {
      const { path } = JSON.parse(match[2]) as { path: string }
      const item = { path } as FileSearchItem
      if (match[1] === 'copy-path') await copyPath(item)
      else await openFile(item, match[1] === 'reveal')
    } catch {
      // A malformed payload is ignored; nothing was opened or copied.
    }
    return true
  }

  /**
   * Remove the row notice, for example when the query changes.
   * @returns No return value.
   */
  function clearNotice(): void {
    notice.value = null
  }

  return { notice, openFile, copyPath, showMenu, handleMenuCommand, clearNotice }
}
