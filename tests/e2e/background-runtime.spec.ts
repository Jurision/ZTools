import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

test('background source runtime keeps host and settings plugin hidden', async () => {
  test.setTimeout(90_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-background-runtime-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  await fs.mkdir(legacyRoot)
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        ZTOOLS_E2E: '1',
        ZTOOLS_BACKGROUND_TEST: '1',
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const page = await application.firstWindow()
    await expect(page.locator('.search-input')).toBeAttached()
    expect(
      await application.evaluate(({ BrowserWindow, app, globalShortcut }) => ({
        visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
        focused: BrowserWindow.getFocusedWindow() !== null,
        root: app.getPath('userData'),
        registered: globalShortcut.isRegistered('Alt+Space')
      }))
    ).toEqual({ visible: false, focused: false, root: dataRoot, registered: false })

    // Exercise the actual blur callback with partial native data, without moving OS focus.
    if (process.platform === 'win32') {
      expect(
        await application.evaluate(({ BrowserWindow, app }) => {
          const localRequire = process
            .getBuiltinModule('module')
            .createRequire(app.getAppPath() + '/package.json')
          const native = localRequire('./resources/lib/win/ztools_native.node')
          const window = BrowserWindow.getAllWindows()[0]
          const originalRead = native.getActiveWindow
          const originalVisible = window.isVisible
          const originalE2E = process.env.ZTOOLS_E2E
          let reads = 0
          try {
            native.getActiveWindow = () => {
              reads++
              return { pid: 987654, hwnd: 123 }
            }
            // The native window stays hidden; only the guard's visibility query is simulated.
            window.isVisible = () => true
            // Bypass only the E2E blur exemption for this synchronous event. The separate
            // BACKGROUND_TEST flag still blocks focus/show, and no startup code is rerun.
            process.env.ZTOOLS_E2E = '0'
            window.emit('blur')
            return reads
          } finally {
            native.getActiveWindow = originalRead
            window.isVisible = originalVisible
            process.env.ZTOOLS_E2E = originalE2E
          }
        })
      ).toBeGreaterThan(0)
    }

    // Verify that search IPC and actual icon protocol still respond after the focus transition.
    const fixtureIcon = path.join(dataRoot, 'fixture-icon.png')
    const png = await application.evaluate(({ nativeImage }) =>
      nativeImage
        .createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 })
        .toPNG()
        .toString('base64')
    )
    await fs.writeFile(fixtureIcon, Buffer.from(png, 'base64'))
    const icon = `ztools-icon://${encodeURIComponent(fixtureIcon)}`
    await application.evaluate(({ ipcMain }, icon) => {
      ipcMain.removeHandler('get-apps')
      ipcMain.handle('get-apps', () => [
        { name: 'Focus Fixture', path: 'C:/Fixture/test.exe', icon }
      ])
    }, icon)
    await page.reload()
    await expect(page.locator('.search-input')).toBeAttached()
    await page.locator('.search-input').fill('Focus Fixture')
    await expect(page.locator('.app-item').filter({ hasText: 'Focus Fixture' })).toHaveCount(1)
    await expect
      .poll(() =>
        page
          .locator('.app-item img')
          .evaluateAll((images) =>
            images.some(
              (image) =>
                (image as HTMLImageElement).src.startsWith('ztools-icon:') &&
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0
            )
          )
      )
      .toBe(true)
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)

    // Exercise the real settings launch path without clicks or OS focus activation.
    await page.evaluate(() => (window as any).ztools.openSettings())
    await expect
      .poll(
        () =>
          application!.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .some((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
          ),
        { timeout: 30_000 }
      )
      .toBe(true)
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  } finally {
    await application?.close()
  }
})
