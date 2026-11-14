import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { app } from 'electron'
import type { Command } from './types'
import { extractAcronym } from '../../utils/common'
import { toZToolsIconUrl } from '../../common/iconUtils'
import {
  installationIdentity,
  productFamily,
  type ApplicationRegistration
} from '@shared/applicationInstallation'
import {
  applicationTargetKey,
  deduplicateApplications,
  normalizeApplicationPath
} from '@shared/applicationIdentity'

export interface ShortcutLaunchMetadata {
  path: string
  targetPath: string
  launchSignature: string
  argumentSignature?: string
  runAsAdmin?: boolean
  targetExists?: boolean
  description?: string
  productName?: string
  publisher?: string
}

export interface InstalledAppCandidate {
  path: string
  label: string
  source: 'app-path' | 'registered' | 'directory'
  subsystem: number
  productName?: string
  description?: string
  originalFilename?: string
  publisher?: string
}

const execFileAsync = promisify(execFile)
const noise =
  /unins|uninstall|updat(?:e|er)|setup|install(?:er)?|helper|crash|reporter|handler|broker|service|daemon|elevat|repair|maintenan|diagnos|debug|global.?flags|rundll|regsvr|获取帮助|卸载|更新|安装|助手|服务/i

/**
 * Normalize product labels for case, spacing and version-insensitive identity matching.
 * @param value Executable, folder or registered product label.
 * @returns Comparable application identity.
 */
function identity(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.exe$/i, '')
    .replace(/\b\d+(?:\.\d+)+(?:\S*)?/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Select GUI entry points with product identity instead of indiscriminately indexing executables.
 * @param candidate Read-only registry/directory/PE metadata.
 * @returns Whether this is a suitable fallback application entry.
 */
export function isInstalledGuiApplication(candidate: InstalledAppCandidate): boolean {
  if (candidate.subsystem !== 2 || !/\.exe$/i.test(candidate.path)) return false
  if (/[\\/](?:windows|windowsapps)[\\/]/i.test(candidate.path)) return false
  const filename = path.win32.basename(candidate.path)
  if (
    noise.test(
      [filename, candidate.label, candidate.description, candidate.originalFilename].join(' ')
    )
  )
    return false
  const product = (candidate.productName || '').trim()
  if (
    !product ||
    /^(electron|microsoftwindows(?:operatingsystem)?|nodejs)$/i.test(productIdentity(product))
  )
    return false
  // App Paths contains internal COM/server/host endpoints as well as user-facing applications.
  if (
    /\b(?:component|host|server|guard|worker|broker|telemetry)\b/i.test(candidate.description || '')
  )
    return false
  if (candidate.source === 'app-path') return true
  const executable = identity(filename)
  const label = identity(candidate.label)
  const productId = identity(product)
  // Registered DisplayIcon identifies one entry point; corroborate localized/internal-name
  // mismatches with an exact executable description instead of trusting arbitrary directory files.
  if (
    candidate.source === 'registered' &&
    executable.length >= 2 &&
    executable === identity(candidate.description || '')
  )
    return true
  // A product prefix alone does not establish a public entry point (guard/worker/agent/etc.).
  // Directory discovery accepts the exact product executable or a recognized product launcher.
  return (
    executable.length >= 2 &&
    [label, productId].some(
      (value) =>
        value === executable ||
        (value.length >= 4 &&
          ['launcher', 'applauncher', 'launch'].some((suffix) => executable === value + suffix))
    )
  )
}

/**
 * Merge fallback entry points while preserving existing shortcut names, targets and arguments.
 * @param shortcuts Existing shortcut scan results.
 * @param candidates Bounded registry and installation metadata.
 * @param metadata Verified shortcut launch settings; missing entries remain distinct.
 * @param registrations Current registry-backed installation ownership.
 * @returns Existing commands followed by unique, validated GUI applications.
 */
export function mergeInstalledApplications(
  shortcuts: Command[],
  candidates: InstalledAppCandidate[],
  metadata: ShortcutLaunchMetadata[] = [],
  registrations: ApplicationRegistration[] = []
): Command[] {
  const details = new Map(metadata.map((item) => [normalizeApplicationPath(item.path), item]))
  const result = deduplicateApplications(
    shortcuts
      .filter((item) => {
        const detail = details.get(normalizeApplicationPath(item.path))
        return !(
          detail?.targetExists === false &&
          normalizeApplicationPath(detail.targetPath) ===
            normalizeApplicationPath(item.targetPath || '')
        )
      })
      .map((item) => {
        const detail = details.get(normalizeApplicationPath(item.path))
        // A shortcut changed between the two readers: do not attach metadata from another target.
        return detail &&
          item.targetPath &&
          normalizeApplicationPath(detail.targetPath) === normalizeApplicationPath(item.targetPath)
          ? {
              ...item,
              installationIdentity: installationIdentity(
                detail.targetPath,
                detail.productName,
                detail.publisher,
                registrations
              ),
              productDescription: detail.description,
              launchSignature: detail.launchSignature,
              argumentSignature: detail.argumentSignature,
              runAsAdmin: detail.runAsAdmin
            }
          : item
      })
  )
  const exactTargets = new Map(
    result.map((entry) => [normalizeApplicationPath(entry.targetPath || entry.path), entry])
  )
  const installations = new Map<string, Command[]>()
  for (const entry of result)
    if (entry.installationIdentity)
      installations.set(entry.installationIdentity, [
        ...(installations.get(entry.installationIdentity) || []),
        entry
      ])
  const discovered = new Map<string, InstalledAppCandidate>()
  for (const candidate of candidates) {
    if (!isInstalledGuiApplication(candidate)) continue
    const key = normalizeApplicationPath(candidate.path)
    const owners =
      installations.get(
        installationIdentity(
          candidate.path,
          candidate.productName,
          candidate.publisher,
          registrations
        ) || ''
      ) || []
    // An installation can be a suite: never merge Word and Excel merely because ProductName matches.
    // A single shortcut is not proof of a single suite component: conflicting descriptions stay separate.
    const describedOwners = candidate.description
      ? owners.filter(
          (entry) =>
            productFamily(entry.productDescription || '') ===
            productFamily(candidate.description || '')
        )
      : []
    const existing =
      exactTargets.get(key) ||
      (owners.length === 1 &&
      (!candidate.description || !owners[0].productDescription || describedOwners.length === 1)
        ? owners[0]
        : describedOwners.length === 1
          ? describedOwners[0]
          : undefined)
    if (
      !existing &&
      owners.length > 1 &&
      new Set(owners.map((entry) => normalizeApplicationPath(entry.targetPath || entry.path)))
        .size === 1
    )
      continue
    // A real shortcut already identifies this installation, including necessary startup arguments.
    // Keep discovery labels as search aliases instead of adding a bare executable alongside it.
    if (existing) {
      // Shared hosts can represent several independent apps; do not assign the host name to one.
      if (
        result.filter(
          (entry) =>
            applicationTargetKey(entry) === applicationTargetKey(existing) ||
            normalizeApplicationPath(entry.targetPath || entry.path) === key
        ).length === 1
      ) {
        existing.aliases = [
          ...new Set(
            [...(existing.aliases || []), candidate.label, candidate.productName || ''].filter(
              (name) => name && name.toLowerCase() !== existing.name.toLowerCase()
            )
          )
        ]
        existing.sourcePaths = [
          ...new Set([...(existing.sourcePaths || []), existing.path, candidate.path])
        ]
      }
      continue
    }
    const previous = discovered.get(key)
    // Prefer a registered user-facing name even when a directory/App Paths record arrived first.
    if (!previous || (previous.source !== 'registered' && candidate.source === 'registered'))
      discovered.set(key, candidate)
  }
  // Sort entry points by evidence, independent of filesystem/registry enumeration order.
  const ordered = [...discovered.values()].sort(
    (a, b) =>
      fallbackPriority(a) - fallbackPriority(b) ||
      normalizeApplicationPath(a.path).localeCompare(normalizeApplicationPath(b.path))
  )
  const fallbackComponents = new Map<string, Command>()
  for (const candidate of ordered) {
    const owner = installationIdentity(
      candidate.path,
      candidate.productName,
      candidate.publisher,
      registrations
    )
    const component = owner
      ? JSON.stringify([owner, productFamily(candidate.description || candidate.productName || '')])
      : undefined
    const previous = component ? fallbackComponents.get(component) : undefined
    if (previous) {
      previous.sourcePaths = [
        ...new Set([...(previous.sourcePaths || []), previous.path, candidate.path])
      ]
      previous.aliases = [...new Set([...(previous.aliases || []), candidate.label])]
      continue
    }
    // Only a recognized alternate launcher can collapse into an existing primary of the same
    // product in the exact same directory. Never merge versions, suites or browser profiles by name.
    const primary = isAlternateLauncher(candidate)
      ? result.find((entry) => isPrimaryProductEntry(entry, candidate))
      : undefined
    if (primary) {
      primary.sourcePaths = [
        ...new Set([...(primary.sourcePaths || []), primary.path, candidate.path])
      ]
      continue
    }
    const name =
      candidate.source === 'registered' && candidate.label.trim()
        ? candidate.label.trim()
        : candidate.productName!.trim()
    const command: Command = {
      name,
      path: candidate.path,
      targetPath: candidate.path,
      installationIdentity: owner,
      icon: toZToolsIconUrl(candidate.path),
      acronym: extractAcronym(name)
    }
    result.push(command)
    if (component) fallbackComponents.set(component, command)
  }
  return deduplicateApplications(result)
}

/**
 * Normalize a product label without removing version/channel digits.
 * @param value Product name or executable stem.
 * @returns Comparable label with punctuation and whitespace removed.
 */
function productIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.exe$/i, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Recognize generic alternate launchers using product metadata, never a brand-specific list.
 * @param candidate Validated executable candidate.
 * @returns Whether its stem is the exact product plus a launcher suffix.
 */
function isAlternateLauncher(candidate: InstalledAppCandidate): boolean {
  const product = productIdentity(candidate.productName || '')
  const stem = productIdentity(path.win32.basename(candidate.path))
  return (
    product.length >= 3 &&
    ['launcher', 'applauncher', 'launch'].some((suffix) => stem === product + suffix)
  )
}

/**
 * Prefer primary programs, then registered names, before alternate launchers.
 * @param candidate Validated fallback entry.
 * @returns Stable priority; lower values win.
 */
function fallbackPriority(candidate: InstalledAppCandidate): number {
  return (
    (isAlternateLauncher(candidate) ? 10 : 0) +
    (candidate.source === 'registered' ? 0 : candidate.source === 'app-path' ? 1 : 2)
  )
}

/**
 * Prove that an existing ordinary entry already launches this alternate launcher's product.
 * @param entry Preserved shortcut or earlier primary executable.
 * @param candidate Alternate launcher to assess.
 * @returns Whether the fallback duplicates the same product's primary in the same install directory.
 */
function isPrimaryProductEntry(entry: Command, candidate: InstalledAppCandidate): boolean {
  const target = entry.targetPath || entry.path
  if (!applicationTargetKey(entry)) return false
  const product = productIdentity(candidate.productName || '')
  return (
    normalizeApplicationPath(path.win32.dirname(target)) ===
      normalizeApplicationPath(path.win32.dirname(candidate.path)) &&
    productIdentity(path.win32.basename(target)) === product
  )
}

export interface InstalledAppDiscoveryResult {
  candidates: InstalledAppCandidate[]
  complete: boolean
  error?: string
  shortcuts?: ShortcutLaunchMetadata[]
  registrations?: ApplicationRegistration[]
}

/**
 * Validate helper output and preserve completeness independently from candidate count.
 * @param value Parsed helper response.
 * @returns Explicit complete/partial metadata suitable for cache refresh decisions.
 */
export function parseInstalledDiscoveryResult(value: unknown): InstalledAppDiscoveryResult {
  const data = value as Partial<InstalledAppDiscoveryResult> | null
  if (!data || !Array.isArray(data.candidates) || typeof data.complete !== 'boolean') {
    return {
      candidates: [],
      complete: false,
      error: 'Invalid installed application discovery response'
    }
  }
  const candidates = data.candidates.filter(
    (item) =>
      item &&
      typeof item.path === 'string' &&
      typeof item.label === 'string' &&
      typeof item.subsystem === 'number' &&
      ['app-path', 'registered', 'directory'].includes(item.source)
  )
  const complete = data.complete && candidates.length === data.candidates.length
  return {
    candidates,
    complete,
    ...(Array.isArray(data.registrations)
      ? {
          registrations: data.registrations.filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.root === 'string' &&
              typeof item.name === 'string' &&
              (item.publisher === undefined || typeof item.publisher === 'string')
          )
        }
      : {}),
    ...(Array.isArray(data.shortcuts)
      ? {
          shortcuts: data.shortcuts.filter(
            (item) =>
              item &&
              typeof item.path === 'string' &&
              typeof item.targetPath === 'string' &&
              (item.runAsAdmin === undefined || typeof item.runAsAdmin === 'boolean') &&
              typeof item.launchSignature === 'string' &&
              (item.launchSignature === 'default' ||
                /^[a-f0-9]{64}$/i.test(item.launchSignature)) &&
              (item.argumentSignature === undefined ||
                item.argumentSignature === 'default' ||
                (typeof item.argumentSignature === 'string' &&
                  /^[a-f0-9]{64}$/i.test(item.argumentSignature)))
          )
        }
      : {}),
    ...(complete
      ? {}
      : {
          error:
            typeof data.error === 'string'
              ? data.error
              : 'Incomplete installed application discovery'
        })
  }
}

/**
 * Read known installation sources in a hidden bounded helper; never execute candidate programs.
 * @param shortcuts Existing shortcut paths; raw arguments are never returned or logged.
 * @returns Candidate metadata and explicit completeness; failure must not replace a previously complete cache.
 */
export async function discoverInstalledApplications(
  shortcuts: Command[] = []
): Promise<InstalledAppDiscoveryResult> {
  const script = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'resources',
        'windows-installed-apps.ps1'
      )
    : path.join(app.getAppPath(), 'resources', 'windows-installed-apps.ps1')
  try {
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const pending = execFileAsync(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 40000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }
    )
    pending.child.stdin?.on('error', () => {})
    pending.child.stdin?.end(
      JSON.stringify(
        shortcuts
          .filter((item) => /\.lnk$/i.test(item.path))
          .map((item) => ({ path: item.path, targetPath: item.targetPath }))
      )
    )
    const { stdout } = await pending
    const value: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ''))
    return parseInstalledDiscoveryResult(value)
  } catch (error) {
    console.warn(
      '[Scanner] Installed application fallback unavailable; keeping shortcut results:',
      error instanceof Error ? error.message : String(error)
    )
    return {
      candidates: [],
      complete: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
