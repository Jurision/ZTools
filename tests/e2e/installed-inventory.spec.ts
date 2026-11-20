import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { builtinModules } from 'node:module'
import { build } from 'vite'

const projectRoot = path.resolve(__dirname, '../..')
test.use({ screenshot: 'off', trace: 'off' })

test('installed inventory uses real Windows links and SQLite without taking focus', async () => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(180_000)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-installed-e2e-'))
  await fs.mkdir(path.join(root, 'legacy'))
  // Compile the same source module for direct Electron invocation, not an application package.
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@shared': path.join(projectRoot, 'src/shared') } },
    build: {
      outDir: path.join(root, 'bundle'),
      lib: {
        entry: path.join(projectRoot, 'src/main/core/commandScanner/installedLaunchers.ts'),
        formats: ['cjs'],
        fileName: () => 'inventory.cjs'
      },
      rollupOptions: {
        external: (id) => id === 'electron' || id.startsWith('node:') || builtinModules.includes(id)
      }
    }
  })
  const application = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      ZTOOLS_E2E: '1',
      ZTOOLS_BACKGROUND_TEST: '1',
      ZTOOLS_DATA_ROOT: root,
      ZTOOLS_LEGACY_USER_DATA_PATH: path.join(root, 'legacy'),
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
  try {
    const host = await application.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    const result = await application.evaluate(
      async ({ app, shell, ipcMain, BrowserWindow }, { root, projectRoot }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(app.getAppPath() + '/package.json')
        const fs = require('node:fs/promises')
        const path = require('node:path')
        const { DatabaseSync } = require('node:sqlite')
        const { spawn } = require('node:child_process')
        const inventory = require(path.join(root, 'bundle/inventory.cjs'))
        const engineRoot = path.join(root, 'Androws/Application')
        const target = path.join(engineRoot, 'AndrowsLauncher.exe')
        const provider = path.join(root, 'provider')
        await fs.mkdir(engineRoot, { recursive: true })
        await fs.mkdir(path.join(provider, 'db'), { recursive: true })
        await fs.writeFile(target, 'fixture executable, never run')
        const db = new DatabaseSync(path.join(provider, 'db/InstalledApp.db'))
        try {
          db.exec(
            "PRAGMA journal_mode=WAL; CREATE TABLE apps(package_name TEXT,name TEXT,version_name TEXT,engine_name TEXT,state INTEGER,icon TEXT); INSERT INTO apps VALUES('org.fixture.reader','测试阅读器','1.0','VBox',1003,''); INSERT INTO apps VALUES('org.fixture.player','测试播放器','2.0','VBox',1003,'')"
          )
          const registration = [{ id: 'fixture', name: 'Engine', root: engineRoot }]
          const options = { androwsRoot: provider }
          const first = await inventory.reconcileInstalledLaunchers([], [], registration, options)
          const launches = first.commands.map((x: any) => shell.readShortcutLink(x.path))
          const metadata = await new Promise<any>((resolve, reject) => {
            const child = spawn(
              'powershell.exe',
              [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                path.join(projectRoot, 'resources/windows-installed-apps.ps1'),
                '-ShortcutMetadataOnly'
              ],
              { windowsHide: true, timeout: 20000 }
            )
            let output = ''
            child.stdout.on('data', (data: Buffer) => {
              output += data.toString('utf8')
            })
            child.on('error', reject)
            child.on('close', (code: number) => {
              if (code) reject(Error('metadata failed'))
              else {
                try {
                  resolve(JSON.parse(output.replace(/^\uFEFF/, '')))
                } catch (error) {
                  reject(error)
                }
              }
            })
            child.stdin.end(JSON.stringify(first.commands))
          })
          // Use a real Windows shell link with arguments, cwd and an icon, then delete its source.
          const editor = path.join(root, 'editor.exe')
          const original = path.join(root, 'Desktop Editor.lnk')
          await fs.writeFile(editor, 'never run')
          shell.writeShortcutLink(original, {
            target: editor,
            args: '--profile "fixture profile"',
            cwd: root,
            icon: editor
          })
          const before = shell.readShortcutLink(original)
          const commands = [{ name: '测试编辑器', path: original, targetPath: editor }]
          const details = [
            {
              path: original,
              targetPath: editor,
              targetExists: true,
              launchSignature: 'a'.repeat(64),
              argumentSignature: 'b'.repeat(64)
            }
          ]
          const combined = await inventory.reconcileInstalledLaunchers(
            commands,
            details,
            registration,
            options
          )
          await fs.unlink(original)
          const afterDeletion = await inventory.reconcileInstalledLaunchers(
            [],
            [],
            registration,
            options
          )
          const retained = afterDeletion.commands.find((x: any) => x.name === '测试编辑器')
          const after = shell.readShortcutLink(retained.path)
          db.exec("UPDATE apps SET state=2003 WHERE package_name='org.fixture.reader'")
          const afterUninstall = await inventory.reconcileInstalledLaunchers(
            afterDeletion.commands,
            afterDeletion.metadata,
            registration,
            options
          )
          ipcMain.removeHandler('get-apps')
          ipcMain.handle('get-apps', () => afterDeletion.commands)
          return {
            first: first.commands.length,
            combined: combined.commands.length,
            before,
            after,
            metadata: metadata.shortcuts.map((x: any) => x.androwsPackage),
            metadataComplete: metadata.complete,
            launches,
            namesAfterDelete: afterDeletion.commands.map((x: any) => x.name),
            namesAfterUninstall: afterUninstall.commands.map((x: any) => x.name),
            focused: !!BrowserWindow.getFocusedWindow(),
            visible: BrowserWindow.getAllWindows().some((w) => w.isVisible()),
            userData: app.getPath('userData')
          }
        } finally {
          db.close()
        }
      },
      { root, projectRoot }
    )
    expect(result.first).toBe(2)
    expect(result.combined).toBe(3)
    expect(result.before).toEqual(result.after)
    expect(result.metadataComplete).toBe(true)
    expect(result.metadata).toEqual(['org.fixture.reader', 'org.fixture.player'])
    expect(result.launches.map((x) => x.args)).toEqual([
      '--from 2 --launch-pkg-name org.fixture.reader --launch-proc-name Androws.exe',
      '--from 2 --launch-pkg-name org.fixture.player --launch-proc-name Androws.exe'
    ])
    expect(result.namesAfterDelete).toEqual(
      expect.arrayContaining(['测试编辑器', '测试阅读器', '测试播放器'])
    )
    expect(result.namesAfterUninstall).not.toContain('测试阅读器')
    expect(result.namesAfterUninstall).toEqual(expect.arrayContaining(['测试编辑器', '测试播放器']))
    expect(result.focused).toBe(false)
    expect(result.visible).toBe(false)
    expect(result.userData).toBe(root)
  } finally {
    await application.close()
  }
})
