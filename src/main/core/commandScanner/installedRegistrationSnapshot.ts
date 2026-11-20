import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { app } from 'electron'
import { extendInstallationSnapshot } from './installedLaunchers'

/**
 * Check public registrations, provider database stamps and retained executable existence.
 * @returns Opaque fingerprint; failure rejects so it cannot be mistaken for an empty inventory.
 * @throws Helper timeout, registry failure or malformed response.
 */
export async function readInstalledRegistrationSnapshot(): Promise<string> {
  const script = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'resources',
        'windows-installed-apps.ps1'
      )
    : path.join(app.getAppPath(), 'resources', 'windows-installed-apps.ps1')
  const { stdout } = await promisify(execFile)(
    path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-RegistrationSnapshotOnly'
    ],
    { windowsHide: true, timeout: 10000, maxBuffer: 4096, encoding: 'utf8' }
  )
  const digest = stdout.replace(/^\uFEFF/, '').trim()
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid installed registration snapshot')
  return extendInstallationSnapshot(digest)
}
