import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, dialog, type BrowserWindow } from 'electron'

/**
 * Ask Explorer to pin the selected launch entry with its own localized Shell action.
 * @param item Absolute launcher path or an AppsFolder identity prefixed with uwp:.
 * @param destination Windows surface selected in the result menu.
 * @param owner Launcher window for the Windows handoff.
 * @returns User-facing status for the request.
 */
export async function pinWindowsApplication(
  item: string,
  destination: string,
  owner: BrowserWindow
): Promise<string> {
  if (
    process.platform !== 'win32' ||
    !['start', 'taskbar'].includes(destination) ||
    typeof item !== 'string' ||
    item.length > 32767 ||
    /[\x00-\x1f]/.test(item) ||
    !(
      /^uwp:.+$/i.test(item) ||
      (path.win32.isAbsolute(item) && /\.(exe|lnk|appref-ms)$/i.test(item))
    )
  )
    return 'Windows 不支持固定这个入口'

  const surface = destination === 'start' ? '开始菜单' : '任务栏'
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath()
  const helper = path.join(base, 'resources', 'windows-pin-application.ps1')
  try {
    // Keep user-controlled paths out of PowerShell source and invoke only the requested Shell verb.
    /**
     * Run the selected Shell operation without putting user input in executable code.
     * @param reveal Open the real item's folder for interactive pinning.
     * @returns Shell state reported by the helper.
     */
    const run = async (reveal: boolean): Promise<string> => {
      const { stdout } = await promisify(execFile)(
        path.join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        ),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          helper,
          '-Destination',
          destination,
          ...(reveal ? ['-Reveal'] : [])
        ],
        { windowsHide: true, timeout: 15000, env: { ...process.env, ZTOOLS_PIN_ITEM: item } }
      )
      return stdout.trim()
    }
    switch (await run(false)) {
      case 'pinned':
        return `已固定到${surface}`
      case 'already':
        return `此应用已固定到${surface}`
      case 'missing':
        return '找不到这个应用入口'
      case 'interactive':
      case 'unavailable': {
        const { response } = await dialog.showMessageBox(owner, {
          type: 'info',
          message: `在 Windows 中固定到${surface}`,
          detail: `打开后，右键点击已选中的应用，选择“固定到${surface}”。如果未看到该项，请展开“显示更多选项”。`,
          buttons: ['打开并选中应用', '取消'],
          cancelId: 1,
          defaultId: 0
        })
        if (response !== 0) return '已取消'
        return (await run(true)) === 'revealed'
          ? `请在 Windows 中右键选择“固定到${surface}”`
          : '无法在资源管理器中定位这个应用'
      }
    }
  } catch (error) {
    const failure = error as { code?: string | number; killed?: boolean }
    console.warn('[WindowsPin] Shell operation failed', destination, failure.code, failure.killed)
    return failure.killed ? 'Windows 固定操作超时，请重试' : 'Windows 固定组件执行失败，请重试'
  }
  return 'Windows 固定组件返回了未知状态'
}
