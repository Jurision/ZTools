import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => {
      throw Error('Real profile access prohibited')
    }
  },
  shell: {
    writeShortcutLink: () => {
      throw Error('Unmocked shortcut writer')
    }
  }
}))
import {
  extendInstallationSnapshot,
  getRetainedLauncherCommands,
  readAndrowsInventory,
  reconcileInstalledLaunchers,
  type AndroidInstallation,
  type LauncherInventoryOptions
} from '../../src/main/core/commandScanner/installedLaunchers'
import type { Command } from '../../src/main/core/commandScanner/types'
import type { ShortcutLaunchMetadata } from '../../src/main/core/commandScanner/windowsInstalledApps'
import type { ApplicationRegistration } from '../../src/shared/applicationInstallation'

let root: string
let options: LauncherInventoryOptions
let registration: ApplicationRegistration
let command: Command
let metadata: ShortcutLaunchMetadata
let rows: AndroidInstallation[]

/**
 * Create a fixture file, never execute its contents.
 * @param filename Isolated file location.
 * @param content Fixture bytes.
 * @returns Completion of the fixture write.
 */
async function put(filename: string, content = 'fixture'): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  await fs.writeFile(filename, content)
}

/**
 * Create independent Android app fixtures sharing one installed engine.
 * @param count Number of package identities.
 * @returns Registered engine and writable installation rows.
 */
async function android(count = 2): Promise<ApplicationRegistration[]> {
  const engineRoot = path.join(root, 'Androws', 'Application')
  await put(path.join(engineRoot, 'AndrowsLauncher.exe'))
  await put(path.join(options.androwsRoot!, 'db', 'InstalledApp.db'))
  rows = Array.from({ length: count }, (_, i) => ({
    package_name: `org.fixture.app${i}`,
    name: `测试应用 ${i}`,
    state: 1003,
    version_name: '1.0',
    engine_name: 'VBox'
  }))
  return [{ id: 'fixture-engine', name: 'Fixture engine', root: engineRoot }]
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-inventory-'))
  rows = []
  options = {
    directory: path.join(root, 'private'),
    androwsRoot: path.join(root, 'provider'),
    readInventory: async () => rows,
    writeShortcut: (filename, details) => {
      writeFileSync(filename, JSON.stringify(details))
      return true
    }
  }
  registration = { id: 'fixture-editor', root: path.join(root, 'Editor'), name: 'Editor' }
  command = {
    name: '编辑器',
    path: path.join(root, 'Desktop', 'Editor.lnk'),
    targetPath: path.join(registration.root, 'Editor.exe')
  }
  metadata = {
    path: command.path,
    targetPath: command.targetPath!,
    targetExists: true,
    launchSignature: 'default',
    argumentSignature: 'default'
  }
  await put(command.path, 'exact link bytes with args/cwd/elevation')
  await put(command.targetPath!)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe.runIf(process.platform === 'win32')('shortcut-independent application inventory', () => {
  it('discovers registered game protocol entries without a desktop URL and drops uninstalled ones', async () => {
    const game = {
      id: 'HKEY_LOCAL_MACHINE\\Uninstall\\Steam App 12345',
      root: path.join(root, 'Game'),
      name: 'Fixture Game',
      icon: path.join(root, 'game.ico')
    }
    const first = await reconcileInstalledLaunchers([], [], [game], options)
    expect(first.commands).toMatchObject([
      { name: 'Fixture Game', path: 'steam://rungameid/12345' }
    ])
    expect(
      (await reconcileInstalledLaunchers(first.commands, [], [game], options)).commands
    ).toHaveLength(1)
    expect((await reconcileInstalledLaunchers(first.commands, [], [], options)).commands).toEqual(
      []
    )
  })

  it.each(['.cmd', '.bat', '.com'])(
    'retains installed script launches ending in %s',
    async (extension) => {
      const target = command.targetPath!.replace(/\.exe$/, extension)
      await put(target)
      const first = await reconcileInstalledLaunchers(
        [{ ...command, targetPath: target }],
        [{ ...metadata, targetPath: target }],
        [registration],
        options
      )
      await fs.unlink(command.path)
      expect(
        (await reconcileInstalledLaunchers(first.commands, first.metadata, [registration], options))
          .commands
      ).toHaveLength(1)
      await fs.unlink(target)
      expect((await reconcileInstalledLaunchers([], [], [registration], options)).commands).toEqual(
        []
      )
    }
  )

  it('keeps an installed application after its only desktop shortcut is deleted', async () => {
    const first = await reconcileInstalledLaunchers([command], [metadata], [registration], options)
    expect(first.commands).toHaveLength(1)
    const copy = first.commands[0].path
    expect(copy).not.toBe(command.path)
    expect(await fs.readFile(copy, 'utf8')).toBe(await fs.readFile(command.path, 'utf8'))
    expect(first.commands[0].sourcePaths).toContain(command.path)
    await fs.unlink(command.path)
    const retained = await getRetainedLauncherCommands(options)
    const second = await reconcileInstalledLaunchers(
      retained,
      [{ ...metadata, path: copy }],
      [registration],
      options
    )
    expect(second.commands.map((x) => x.name)).toEqual(['编辑器'])
    expect(second.commands[0].path).toBe(copy)
  })

  it('removes an uninstalled registration even if executable and shortcut were left behind', async () => {
    const first = await reconcileInstalledLaunchers([command], [metadata], [registration], options)
    const second = await reconcileInstalledLaunchers(
      [...first.commands, command],
      [...first.metadata, metadata],
      [],
      options
    )
    expect(second.commands).toEqual([])
    expect(await getRetainedLauncherCommands(options)).toEqual([])
    expect(await fs.readFile(command.path, 'utf8')).toContain('exact link')
  })

  it('retains a portable app until its actual executable is removed', async () => {
    await reconcileInstalledLaunchers([command], [metadata], [], options)
    await fs.unlink(command.path)
    expect((await reconcileInstalledLaunchers([], [], [], options)).commands).toHaveLength(1)
    await fs.unlink(command.targetPath!)
    expect((await reconcileInstalledLaunchers([], [], [], options)).commands).toEqual([])
  })

  it('does not merge independent installations or discard alternative launch arguments', async () => {
    const other = {
      ...command,
      path: path.join(root, 'Other.lnk'),
      targetPath: path.join(root, 'Other', 'Editor.exe')
    }
    await put(other.path)
    await put(other.targetPath)
    const mode = { ...command, path: path.join(root, 'SafeMode.lnk') }
    await put(mode.path, 'different arguments')
    const result = await reconcileInstalledLaunchers(
      [command, other, mode],
      [
        metadata,
        { ...metadata, path: other.path, targetPath: other.targetPath },
        { ...metadata, path: mode.path, launchSignature: 'a'.repeat(64) }
      ],
      [registration],
      options
    )
    expect(result.commands).toHaveLength(3)
    expect(new Set(result.commands.map((x) => x.path)).size).toBe(3)
  })

  it('refreshes renamed/reinstalled targets without preserving a stale internal route', async () => {
    const first = await reconcileInstalledLaunchers([command], [metadata], [registration], options)
    const updated = { ...first.metadata[0], launchSignature: 'b'.repeat(64) }
    const result = await reconcileInstalledLaunchers(
      first.commands,
      [updated],
      [registration],
      options
    )
    expect(result.commands).toHaveLength(1)
    expect(result.commands[0].path).not.toBe(first.commands[0].path)
  })

  it('uses the newly resolved executable after a retained shortcut changes target', async () => {
    const first = await reconcileInstalledLaunchers([command], [metadata], [registration], options)
    const target = path.join(registration.root, 'Updated.exe')
    await put(target)
    const updated = { ...first.metadata[0], targetPath: target }
    const result = await reconcileInstalledLaunchers(
      first.commands,
      [updated],
      [registration],
      options
    )
    expect(result.commands).toHaveLength(1)
    expect(result.commands[0].targetPath).toBe(target)
    const missing = {
      ...result.metadata[0],
      targetPath: path.join(root, 'missing.exe'),
      targetExists: false
    }
    expect(
      (await reconcileInstalledLaunchers(result.commands, [missing], [registration], options))
        .commands
    ).toEqual([])
  })

  it('rejects removed browser child apps even while their shared browser remains installed', async () => {
    const first = await reconcileInstalledLaunchers(
      [command],
      [{ ...metadata, childTargetExists: true }],
      [registration],
      options
    )
    const result = await reconcileInstalledLaunchers(
      first.commands,
      [{ ...first.metadata[0], childTargetExists: false }],
      [registration],
      options
    )
    expect(result.commands).toEqual([])
  })

  it('discovers all installed Android packages without desktop shortcuts and removes only uninstalled apps', async () => {
    const registrations = await android(4)
    const first = await reconcileInstalledLaunchers([], [], registrations, options)
    expect(first.commands).toHaveLength(4)
    expect(new Set(first.commands.map((x) => x.applicationId)).size).toBe(4)
    for (const item of first.commands) {
      const launch = JSON.parse(await fs.readFile(item.path, 'utf8'))
      expect(launch.args).toMatch(
        /^--from 2 --launch-pkg-name org\.fixture\.app\d --launch-proc-name Androws.exe$/
      )
      expect(launch.cwd).toBe(registrations[0].root)
    }
    rows[0].state = 2003
    rows.splice(1, 1)
    const second = await reconcileInstalledLaunchers(
      first.commands,
      first.metadata,
      registrations,
      options
    )
    expect(second.commands.map((x) => x.name)).toEqual(['测试应用 2', '测试应用 3'])
  })

  it('keeps an installed app while updating or after uninstall failure, but rejects new incomplete installs', async () => {
    const registrations = await android(3)
    rows[2].state = 1002
    await reconcileInstalledLaunchers([], [], registrations, options)
    rows[0].state = 1002
    rows[1].state = 2004
    expect(
      (await reconcileInstalledLaunchers([], [], registrations, options)).commands
    ).toHaveLength(2)
    rows[2].state = 1003
    expect(
      (await reconcileInstalledLaunchers([], [], registrations, options)).commands
    ).toHaveLength(3)
  })

  it('does not use stale Android DB entries after the registered engine is uninstalled', async () => {
    const registrations = await android()
    const first = await reconcileInstalledLaunchers([], [], registrations, options)
    expect(
      (await reconcileInstalledLaunchers(first.commands, first.metadata, [], options)).commands
    ).toEqual([])
  })

  it('does not accept unsafe package names or launch Windows games through the Android engine', async () => {
    const registrations = await android(3)
    rows[0].package_name = 'org.safe --unexpected-argument'
    rows[1].engine_name = 'PCGame'
    const result = await reconcileInstalledLaunchers([], [], registrations, options)
    expect(result.commands.map((x) => x.name)).toEqual(['测试应用 2'])
  })

  it('preserves the last manifest on an unavailable or malformed provider database', async () => {
    const registrations = await android()
    await reconcileInstalledLaunchers([], [], registrations, options)
    const manifest = path.join(options.directory!, 'inventory.json')
    const previous = await fs.readFile(manifest, 'utf8')
    for (const readInventory of [
      async () => {
        throw Error('locked')
      },
      async () => [{ state: 1003 }] as AndroidInstallation[]
    ]) {
      await expect(
        reconcileInstalledLaunchers([], [], registrations, { ...options, readInventory })
      ).rejects.toThrow()
      expect(await fs.readFile(manifest, 'utf8')).toBe(previous)
    }
    await fs.unlink(path.join(options.androwsRoot!, 'db', 'InstalledApp.db'))
    await expect(reconcileInstalledLaunchers([], [], registrations, options)).rejects.toThrow(
      'temporarily unavailable'
    )
    expect(await fs.readFile(manifest, 'utf8')).toBe(previous)
  })

  it('retains the manifest if shortcut creation fails', async () => {
    const registrations = await android()
    await reconcileInstalledLaunchers([], [], registrations, options)
    const previous = await fs.readFile(path.join(options.directory!, 'inventory.json'), 'utf8')
    await expect(
      reconcileInstalledLaunchers([], [], registrations, { ...options, writeShortcut: () => false })
    ).rejects.toThrow()
    expect(await fs.readFile(path.join(options.directory!, 'inventory.json'), 'utf8')).toBe(
      previous
    )
  })

  it('fingerprints WAL changes and executable removal even when registry stays unchanged', async () => {
    await reconcileInstalledLaunchers([command], [metadata], [registration], options)
    const before = await extendInstallationSnapshot('same-registry', options)
    expect(await extendInstallationSnapshot('same-registry', options)).toBe(before)
    await put(path.join(options.androwsRoot!, 'db', 'InstalledApp.db-wal'), 'new app')
    const changed = await extendInstallationSnapshot('same-registry', options)
    expect(changed).not.toBe(before)
    await fs.unlink(command.targetPath!)
    expect(await extendInstallationSnapshot('same-registry', options)).not.toBe(changed)
  })

  it('rejects malformed or out-of-store retained paths without touching the source', async () => {
    await put(
      path.join(options.directory!, 'inventory.json'),
      JSON.stringify([{ command, metadata, registrations: [] }])
    )
    await expect(getRetainedLauncherCommands(options)).rejects.toThrow('Unsafe')
    expect(await fs.readFile(command.path, 'utf8')).toContain('exact link')
  })
})

describe('read-only provider worker', () => {
  it('reads current WAL commits without querying unrelated data or changing the database', async () => {
    const filename = path.join(root, 'InstalledApp.db')
    const db = new DatabaseSync(filename)
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE apps(package_name TEXT,name TEXT,version_name TEXT,engine_name TEXT,state INTEGER,icon TEXT); CREATE TABLE private_data(secret TEXT); INSERT INTO private_data VALUES('fake-do-not-read'); INSERT INTO apps VALUES('org.fixture.reader','测试阅读器','1','VBox',1003,'')"
      )
      const before = createHash('sha256')
        .update(await fs.readFile(filename + '-wal'))
        .digest('hex')
      const result = await readAndrowsInventory(filename)
      expect(result).toEqual([
        {
          package_name: 'org.fixture.reader',
          name: '测试阅读器',
          version_name: '1',
          engine_name: 'VBox',
          state: 1003,
          icon: ''
        }
      ])
      expect(
        createHash('sha256')
          .update(await fs.readFile(filename + '-wal'))
          .digest('hex')
      ).toBe(before)
    } finally {
      db.close()
    }
  })
  it('fails closed on missing/schema-changed/corrupt files', async () => {
    const filename = path.join(root, 'broken.db')
    await expect(readAndrowsInventory(filename)).rejects.toThrow('unavailable')
    await put(filename, 'not sqlite')
    await expect(readAndrowsInventory(filename)).rejects.toThrow('unavailable')
    await fs.unlink(filename)
    const db = new DatabaseSync(filename)
    db.exec('CREATE TABLE unrelated(id INTEGER)')
    db.close()
    await expect(readAndrowsInventory(filename)).rejects.toThrow('unavailable')
  })
})
