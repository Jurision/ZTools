import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

/**
 * Ask Explorer to pin the selected launch entry with its own localized Shell action.
 * @param item Absolute launcher path or an AppsFolder identity prefixed with uwp:.
 * @param destination Windows surface selected in the result menu.
 * @returns User-facing status for the request.
 */
export async function pinWindowsApplication(item: string, destination: string): Promise<string> {
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
        destination
      ],
      { windowsHide: true, timeout: 15000, env: { ...process.env, ZTOOLS_PIN_ITEM: item } }
    )
    switch (stdout.trim()) {
      case 'requested':
        return `已向 Windows 请求固定到${surface}`
      case 'already':
        return `此应用已固定到${surface}`
      case 'missing':
        return '找不到这个应用入口'
      case 'unavailable':
        return `Windows 未提供固定到${surface}的选项`
    }
  } catch {
    // Explorer may be restarting or waiting for a confirmation past the timeout.
  }
  return `无法确认固定结果，请查看 Windows ${surface}`
}
