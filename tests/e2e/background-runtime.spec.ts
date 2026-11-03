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
