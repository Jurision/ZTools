import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { app } from 'electron'
import { deduplicateApplications, type ApplicationIdentity } from '@shared/applicationIdentity'

interface PackageEntry {
  appId: string
  installLocation?: string
}
export interface WebAppIdentity {
  appId: string
  identity: string
  store: boolean
}
const execFileAsync = promisify(execFile)

/**
 * Read only the manifests of already enumerated packages in a bounded hidden process.
 * @param entries Native package activation IDs and installation directories.
 * @returns Proven browser/profile/app identities; failures retain independent package entries.
 */
export async function readPackagedWebAppIdentities(
  entries: PackageEntry[]
): Promise<WebAppIdentity[]> {
  const input = entries.filter((entry) => entry.installLocation)
  if (!input.length) return []
  const script = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'resources',
        'windows-pwa-identities.ps1'
      )
    : path.join(app.getAppPath(), 'resources', 'windows-pwa-identities.ps1')
  try {
    const pending = execFileAsync(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 10000, maxBuffer: 512 * 1024, encoding: 'utf8' }
    )
    pending.child.stdin?.on('error', () => {})
    pending.child.stdin?.end(
      JSON.stringify(input.map(({ appId, installLocation }) => ({ appId, installLocation })))
    )
    const { stdout } = await pending
    const value = JSON.parse(stdout.replace(/^\uFEFF/, ''))
    const allowed = new Set(input.map((entry) => entry.appId))
    return Array.isArray(value)
      ? value.filter(
          (item) =>
            allowed.has(item.appId) &&
            /^[a-f0-9]{64}$/.test(item.identity) &&
            typeof item.store === 'boolean'
        )
      : []
  } catch {
    return []
  }
}

/**
 * Merge proven aliases of one packaged PWA without merging browser channels or profiles.
 * @param entries Original package activation commands.
 * @param identities Manifest-derived identity digests with no raw launch parameters.
 * @returns Canonical commands with all original activations retained as launch variants.
 */
export function mergePackagedWebApps<T extends ApplicationIdentity>(
  entries: T[],
  identities: WebAppIdentity[]
): T[] {
  const metadata = new Map(identities.map((item) => [`uwp:${item.appId}`, item]))
  if (!metadata.size) return entries
  const decorated = entries.map((entry) => {
    const detail = metadata.get(entry.path)
    return detail
      ? {
          ...entry,
          applicationId: undefined,
          webApplicationIdentity: detail.identity,
          webApplicationStore: detail.store
        }
      : entry
  })
  return deduplicateApplications(decorated) as T[]
}
