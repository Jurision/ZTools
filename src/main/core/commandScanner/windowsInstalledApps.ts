import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { app } from 'electron'
import type { Command } from './types'
import { extractAcronym } from '../../utils/common'
import { toZToolsIconUrl } from '../../common/iconUtils'
import {
  applicationLaunchKey,
  deduplicateApplications,
  normalizeApplicationPath
} from '@shared/applicationIdentity'

export interface ShortcutLaunchMetadata {
  path: string
  targetPath: string
  launchSignature: string
}

export interface InstalledAppCandidate {
  path: string
  label: string
  source: 'app-path' | 'registered' | 'directory'
  subsystem: number
  productName?: string
  description?: string
  originalFilename?: string
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
  if (/[\\/]windows[\\/]/i.test(candidate.path)) return false
  const filename = path.win32.basename(candidate.path)
  if (
    noise.test(
      [filename, candidate.label, candidate.description, candidate.originalFilename].join(' ')
    )
  )
    return false
  const product = (candidate.productName || '').trim()
  if (!product || /^(electron|microsoft windows|node\.js)$/i.test(product)) return false
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
  // Product-prefixed host/render binaries are support processes, not separate launchers.
  return (
    executable.length >= 2 &&
    [label, productId].some(
      (value) =>
        value === executable ||
        (value.length >= 4 &&
          executable.startsWith(value) &&
          !/^(?:host|render|renderer|helper)$/.test(executable.slice(value.length)))
    )
  )
}

/**
 * Merge fallback entry points while preserving existing shortcut names, targets and arguments.
 * @param shortcuts Existing shortcut scan results.
 * @param candidates Bounded registry and installation metadata.
 * @param metadata Verified shortcut launch settings; missing entries remain distinct.
 * @returns Existing commands followed by unique, validated GUI applications.
 */
export function mergeInstalledApplications(
  shortcuts: Command[],
  candidates: InstalledAppCandidate[],
  metadata: ShortcutLaunchMetadata[] = []
): Command[] {
  const details = new Map(metadata.map((item) => [normalizeApplicationPath(item.path), item]))
  const result = deduplicateApplications(
    shortcuts.map((item) => {
      const detail = details.get(normalizeApplicationPath(item.path))
      // A shortcut changed between the two readers: do not attach metadata from another target.
      return detail &&
        item.targetPath &&
        normalizeApplicationPath(detail.targetPath) === normalizeApplicationPath(item.targetPath)
        ? { ...item, launchSignature: detail.launchSignature }
        : item
    })
  )
  const targets = new Set(result.map(applicationLaunchKey).filter(Boolean))
  const discovered = new Map<string, InstalledAppCandidate>()
  for (const candidate of candidates) {
    if (!isInstalledGuiApplication(candidate)) continue
    const key = normalizeApplicationPath(candidate.path)
    if (targets.has(applicationLaunchKey({ name: candidate.label, path: candidate.path }))) continue
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
  for (const candidate of ordered) {
    // Only a recognized alternate launcher can collapse into an existing primary of the same
    // product in the exact same directory. Never merge versions, suites or browser profiles by name.
    if (
      isAlternateLauncher(candidate) &&
      result.some((entry) => isPrimaryProductEntry(entry, candidate))
    )
      continue
    const name =
      candidate.source === 'registered' && candidate.label.trim()
        ? candidate.label.trim()
        : candidate.productName!.trim()
    result.push({
      name,
      path: candidate.path,
      targetPath: candidate.path,
      icon: toZToolsIconUrl(candidate.path),
      acronym: extractAcronym(name)
    })
  }
  return result
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
  if (
    !applicationLaunchKey(entry) ||
    (entry.launchSignature && entry.launchSignature !== 'default')
  )
    return false
  const product = productIdentity(candidate.productName || '')
  return (
    normalizeApplicationPath(path.win32.dirname(target)) ===
      normalizeApplicationPath(path.win32.dirname(candidate.path)) &&
    productIdentity(path.win32.basename(target)) === product &&
    productIdentity(entry.name) === product
  )
}

export interface InstalledAppDiscoveryResult {
  candidates: InstalledAppCandidate[]
  complete: boolean
  error?: string
  shortcuts?: ShortcutLaunchMetadata[]
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
    ...(Array.isArray(data.shortcuts)
      ? {
          shortcuts: data.shortcuts.filter(
            (item) =>
              item &&
              typeof item.path === 'string' &&
              typeof item.targetPath === 'string' &&
              typeof item.launchSignature === 'string' &&
              (item.launchSignature === 'default' || /^[a-f0-9]{64}$/i.test(item.launchSignature))
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
      { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }
    )
    pending.child.stdin?.on('error', () => {})
    pending.child.stdin?.end(
      JSON.stringify(shortcuts.filter((item) => /\.lnk$/i.test(item.path)).map((item) => item.path))
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
