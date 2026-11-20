import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { app, shell } from 'electron'
import { getZToolsRoot } from '../appData/appDataPaths'
import { normalizeApplicationPath } from '@shared/applicationIdentity'
import type { ApplicationRegistration } from '@shared/applicationInstallation'
import type { Command } from './types'
import type { ShortcutLaunchMetadata } from './windowsInstalledApps'
import { toZToolsIconUrl } from '../../common/iconUtils'

export interface AndroidInstallation {
  package_name: string
  name: string
  version_name: string
  engine_name: string
  state: number
  icon?: string
}
interface SavedLauncher {
  command: Command
  metadata: ShortcutLaunchMetadata
  registrations: string[]
}
export interface LauncherInventoryOptions {
  directory?: string
  androwsRoot?: string
  readInventory?: (filename: string) => Promise<AndroidInstallation[]>
  writeShortcut?: (filename: string, details: Electron.ShortcutDetails) => boolean
}

/**
 * Resolve private inventory paths, keeping background tests away from real application metadata.
 * @param options Explicit fixture overrides.
 * @returns Stable launcher store and optional application-provider root.
 */
function locations(options: LauncherInventoryOptions = {}): {
  directory: string
  androwsRoot: string
} {
  return {
    directory: options.directory || path.join(getZToolsRoot(), 'application-launchers'),
    androwsRoot:
      options.androwsRoot ??
      (process.env.ZTOOLS_BACKGROUND_TEST === '1'
        ? ''
        : path.join(app.getPath('appData'), 'Tencent', 'Androws'))
  }
}

/**
 * Distinguish a missing file from denied access and other incomplete inventory reads.
 * @param filename Explicit local file.
 * @returns Whether a file exists.
 * @throws Unexpected I/O errors, so a failed read cannot erase a valid inventory.
 */
async function exists(filename: string): Promise<boolean> {
  try {
    return (await fs.stat(filename)).isFile()
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

/**
 * Read only the provider's public installation table in an isolated worker.
 * @param filename InstalledApp.db location.
 * @returns Installation rows, without credentials, browsing history or app content.
 * @throws Worker failure, malformed output or timeout.
 */
export async function readAndrowsInventory(filename: string): Promise<AndroidInstallation[]> {
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked/resources/androws-inventory.cjs')
    : path.join(app.getAppPath(), 'resources/androws-inventory.cjs')
  return new Promise((resolve, reject) => {
    const worker = new Worker(script, { workerData: { filename } })
    let received = false
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('Application inventory timeout'))
    }, 5000)
    worker.once('message', (result) => {
      received = true
      clearTimeout(timer)
      void worker.terminate()
      if (result.error || !Array.isArray(result.rows))
        reject(new Error('Application inventory unavailable'))
      else resolve(result.rows)
    })
    worker.once('error', () => {
      clearTimeout(timer)
      reject(new Error('Application inventory worker failed'))
    })
    worker.once('exit', () => {
      clearTimeout(timer)
      if (!received) reject(new Error('Application inventory worker stopped'))
    })
  })
}

/**
 * Read a bounded private launcher manifest; corruption must not look like an empty installation set.
 * @param directory Private launcher store.
 * @returns Previously verified entries.
 * @throws Invalid manifest or unsafe retained launcher paths.
 */
async function readSaved(directory: string): Promise<SavedLauncher[]> {
  const file = path.join(directory, 'inventory.json')
  if (!(await exists(file))) return []
  const data = JSON.parse(await fs.readFile(file, 'utf8'))
  if (
    !Array.isArray(data) ||
    data.length > 5000 ||
    data.some((x) => !x.command?.path || !x.metadata?.targetPath || !Array.isArray(x.registrations))
  )
    throw new Error('Invalid private application inventory')
  if (
    data.some(
      (x) =>
        path.resolve(path.dirname(x.command.path)) !== path.resolve(directory) ||
        !/^[a-f0-9]{64}\.lnk$/.test(path.basename(x.command.path))
    )
  )
    throw new Error('Unsafe private application route')
  return data
}

/**
 * Feed retained routes back through the ordinary metadata reader after upgrades or target changes.
 * @param options Optional isolated store.
 * @returns Existing internal shortcut copies; the subsequent scan verifies their executable targets.
 */
export async function getRetainedLauncherCommands(
  options: LauncherInventoryOptions = {}
): Promise<Command[]> {
  const saved = await readSaved(locations(options).directory)
  const found = await Promise.all(
    saved.map(async (x) => ((await exists(x.command.path)) ? x.command : null))
  )
  return found.filter((x): x is Command => x !== null)
}

/**
 * Hash public inventory changes, including WAL updates and retained executable removal.
 * @param base Current registry fingerprint.
 * @param options Optional isolated paths.
 * @returns Combined installation snapshot; no app names or user text are logged.
 */
export async function extendInstallationSnapshot(
  base: string,
  options: LauncherInventoryOptions = {}
): Promise<string> {
  const loc = locations(options)
  const saved = await readSaved(loc.directory)
  const files = [...new Set(saved.map((x) => x.metadata.targetPath))]
  if (loc.androwsRoot)
    files.push(
      ...['InstalledApp.db', 'InstalledApp.db-wal'].map((x) => path.join(loc.androwsRoot, 'db', x))
    )
  const stamps = await Promise.all(
    files.map(async (file) => {
      try {
        const s = await fs.stat(file)
        return [file, s.size, s.mtimeMs]
      } catch (error: any) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [file, 'missing']
        throw error
      }
    })
  )
  return createHash('sha256')
    .update(JSON.stringify([base, stamps]))
    .digest('hex')
}

/**
 * Retain verified launches independently from desktop/start-menu shortcuts and add provider apps.
 * @param commands Current native shortcut scan.
 * @param metadata Verified shortcut identities.
 * @param registrations Current Windows installation registrations.
 * @param options Fixture paths and injectable I/O only for isolated tests.
 * @returns Commands plus metadata suitable for the existing identity/alias reconciliation.
 * @throws Incomplete provider or filesystem reads; callers must retain the previous complete cache.
 */
export async function reconcileInstalledLaunchers(
  commands: Command[],
  metadata: ShortcutLaunchMetadata[],
  registrations: ApplicationRegistration[],
  options: LauncherInventoryOptions = {}
): Promise<{ commands: Command[]; metadata: ShortcutLaunchMetadata[] }> {
  const loc = locations(options)
  const saved = await readSaved(loc.directory)
  const byPath = new Map(metadata.map((x) => [normalizeApplicationPath(x.path), x]))
  const current = new Map<string, SavedLauncher>()
  const result: Command[] = []
  const details: ShortcutLaunchMetadata[] = []
  // Steam's public per-game uninstall registrations remain after desktop .url removal.
  for (const registration of registrations) {
    const id = /\\Steam App (\d+)$/i.exec(registration.id)?.[1]
    if (!id) continue
    const uri = `steam://rungameid/${id}`
    const original = commands.find((c) => c.path.toLowerCase() === uri)
    const icon = registration.icon
      ?.replace(/^"(.*)"(?:,\s*-?\d+)?$/, '$1')
      .replace(/,\s*-?\d+$/, '')
    result.push({
      name: registration.name,
      path: uri,
      applicationId: `steam:${id}`,
      icon: icon && /^[a-z]:[\\/]/i.test(icon) ? toZToolsIconUrl(icon) : original?.icon,
      aliases: original ? [original.name, ...(original.aliases || [])] : [],
      sourcePaths: [uri]
    })
  }
  const registrationIds = new Set(registrations.map((x) => x.id))
  const dbPath = loc.androwsRoot && path.join(loc.androwsRoot, 'db/InstalledApp.db')
  // Find the registered engine, not a hardcoded drive or a desktop link.
  const engines: string[] = []
  for (const registration of registrations) {
    if (!/Androws/i.test(registration.root)) continue
    for (const folder of [registration.root, path.join(registration.root, 'Application')]) {
      const launcher = path.join(folder, 'AndrowsLauncher.exe')
      if (await exists(launcher)) engines.push(launcher)
    }
  }
  const uniqueEngines = [...new Set(engines)]
  if (
    uniqueEngines.length &&
    dbPath &&
    !(await exists(dbPath)) &&
    saved.some((x) => x.metadata.androwsPackage)
  )
    throw new Error('Android installation database temporarily unavailable')
  // Removed engine registrations are authoritative, even if its old database was left behind.
  const rows =
    uniqueEngines.length && dbPath && (await exists(dbPath))
      ? await (options.readInventory || readAndrowsInventory)(dbPath)
      : []
  if (
    !Array.isArray(rows) ||
    rows.length > 5000 ||
    rows.some(
      (x) =>
        typeof x.package_name !== 'string' ||
        typeof x.name !== 'string' ||
        typeof x.engine_name !== 'string' ||
        !Number.isInteger(x.state)
    )
  )
    throw new Error('Invalid Android installation inventory')
  // Values verified against Androws' bundled InstallState enum: 1003 success, 2003 uninstall success.
  // Keep known installations during updates / failed uninstall, but never invent a newly installed app.
  const installed = rows.filter(
    (x) =>
      x.engine_name === 'VBox' &&
      /^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(x.package_name) &&
      x.name.trim() &&
      (x.state === 1003 ||
        (x.state !== 2003 && saved.some((s) => s.metadata.androwsPackage === x.package_name)))
  )
  await fs.mkdir(loc.directory, { recursive: true })
  // Reuse known entries only while their executable and installation ownership remain valid.
  for (const entry of saved) {
    if (entry.metadata.androwsPackage) continue // The provider table is authoritative, never a cached link.
    if (byPath.has(normalizeApplicationPath(entry.command.path))) continue // Fresh metadata is authoritative.
    if (entry.registrations.length && !entry.registrations.some((id) => registrationIds.has(id)))
      continue
    if (byPath.get(normalizeApplicationPath(entry.command.path))?.childTargetExists === false)
      continue
    if (!(await exists(entry.metadata.targetPath)) || !(await exists(entry.command.path))) continue
    current.set(path.basename(entry.command.path), entry)
  }
  for (const command of commands) {
    if (/^steam:\/\/rungameid\/\d+$/i.test(command.path)) continue // Authoritative registration above.
    const detail = byPath.get(normalizeApplicationPath(command.path))
    if (detail?.androwsPackage) continue // Reconstructed below with stable package identity.
    if (detail?.childTargetExists === false || detail?.targetExists === false) continue
    if (
      !detail ||
      detail.targetExists !== true ||
      !/^[a-z]:[\\/]/i.test(detail.targetPath) ||
      command.searchSource
    ) {
      result.push(command)
      if (detail) details.push(detail)
      continue
    }
    const filename =
      createHash('sha256')
        .update(
          JSON.stringify([normalizeApplicationPath(detail.targetPath), detail.launchSignature])
        )
        .digest('hex') + '.lnk'
    const old = saved.find((x) => path.basename(x.command.path) === filename)
    const owners = registrations
      .filter((r) =>
        normalizeApplicationPath(detail.targetPath).startsWith(
          normalizeApplicationPath(r.root) + '\\'
        )
      )
      .map((r) => r.id)
    // A leftover shortcut and executable must not resurrect an explicitly removed registration.
    if (
      old?.registrations.length &&
      !owners.length &&
      !old.registrations.some((id) => registrationIds.has(id))
    )
      continue
    const destination = path.join(loc.directory, filename)
    // Copy the launch artifact verbatim to preserve parameters, elevation, workdir and window style.
    if (normalizeApplicationPath(command.path) !== normalizeApplicationPath(destination))
      await fs.copyFile(command.path, destination)
    const previous = current.get(filename)
    const retained: Command = {
      ...command,
      path: destination,
      targetPath: detail.targetPath,
      aliases: [
        ...new Set(
          [...(previous?.command.aliases || []), previous?.command.name || '', command.name].filter(
            Boolean
          )
        )
      ],
      sourcePaths: [...new Set([...(previous?.command.sourcePaths || []), command.path])],
      icon:
        command.icon === toZToolsIconUrl(command.path) ? toZToolsIconUrl(destination) : command.icon
    }
    current.set(filename, {
      command: retained,
      metadata: { ...detail, path: destination },
      registrations: owners
    })
  }
  // Regenerate engine routes from installed packages; deleting an external shortcut cannot remove them.
  for (const engine of uniqueEngines)
    for (const row of installed) {
      const identity = JSON.stringify([
        'androws',
        normalizeApplicationPath(engine),
        row.engine_name,
        row.package_name
      ])
      const filename = createHash('sha256').update(identity).digest('hex') + '.lnk'
      const destination = path.join(loc.directory, filename)
      const args = `--from 2 --launch-pkg-name ${row.package_name} --launch-proc-name Androws.exe`
      const iconPath = path.join(
        loc.androwsRoot,
        'apps',
        row.package_name,
        row.package_name + '.ico'
      )
      const icon = (await exists(iconPath)) ? iconPath : engine
      if (
        !(options.writeShortcut || shell.writeShortcutLink)(destination, {
          target: engine,
          args,
          cwd: path.dirname(engine),
          icon,
          description: row.name
        })
      )
        throw new Error('Cannot write installed application launch route')
      const signature = createHash('sha256').update(args).digest('hex')
      const originals = commands.filter((c) => {
        const d = byPath.get(normalizeApplicationPath(c.path))
        return (
          d?.androwsPackage === row.package_name &&
          normalizeApplicationPath(d.targetPath) === normalizeApplicationPath(engine)
        )
      })
      const command: Command = {
        name: row.name.trim(),
        path: destination,
        targetPath: engine,
        applicationId: identity,
        targetVersion: row.version_name,
        applicationDetail: '应用宝',
        icon: toZToolsIconUrl(icon),
        launchSignature: signature,
        argumentSignature: signature,
        sourcePaths: [...new Set(originals.flatMap((c) => [c.path, ...(c.sourcePaths || [])]))],
        aliases: [...new Set(originals.flatMap((c) => [c.name, ...(c.aliases || [])]))]
      }
      current.set(filename, {
        command,
        metadata: {
          path: destination,
          targetPath: engine,
          targetExists: true,
          launchSignature: signature,
          argumentSignature: signature,
          androwsPackage: row.package_name,
          productVersion: row.version_name
        },
        registrations: []
      })
    }
  for (const entry of current.values()) {
    result.push(entry.command)
    details.push(entry.metadata)
  }
  // Atomic manifest replacement only after every provider has been read successfully.
  if (current.size > 5000) throw new Error('Private application inventory exceeds supported limit')
  const temporary = path.join(loc.directory, 'inventory.json.tmp')
  await fs.writeFile(temporary, JSON.stringify([...current.values()]))
  await fs.rename(temporary, path.join(loc.directory, 'inventory.json'))
  return { commands: result, metadata: details }
}
