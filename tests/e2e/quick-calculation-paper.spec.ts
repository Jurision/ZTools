import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { open } from 'lmdb'
const projectRoot = path.resolve(__dirname, '../..')
const pluginPath = path.join(projectRoot, '.local-work/plugins/calculation-paper-next')

/**
 * Run DOM operations only in the isolated hidden calculation paper view.
 * @param app Source Electron instance.
 * @param script Renderer operation.
 * @returns Renderer result, or null before the plugin view exists.
 */
async function inPaper(app: ElectronApplication, script: string): Promise<any> {
  return app.evaluate(async ({ webContents }, input) => {
    const view = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('calculation-paper-next/index.html'))
    return view ? view.executeJavaScript(input) : null
  }, script)
}

test('Enter on a quick calculation continues it as a row of the calculation paper', async () => {
  test.setTimeout(120_000)
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-quick-paper-'))
  const legacyRoot = path.join(dataRoot, 'legacy'),
    devicePath = path.join(dataRoot, 'lmdb/device')
  fs.mkdirSync(legacyRoot, { recursive: true })
  fs.mkdirSync(devicePath, { recursive: true })
  const env = open({ path: devicePath, maxDbs: 6, encoding: 'binary', compression: false })
  const db = env.openDB<string>({ name: 'main', encoding: 'string' })
  db.putSync(
    'ZTOOLS/plugins',
    JSON.stringify({
      _id: 'ZTOOLS/plugins',
      _rev: '1-test',
      data: [
        {
          ...JSON.parse(fs.readFileSync(path.join(pluginPath, 'plugin.json'), 'utf8')),
          path: pluginPath,
          isDevelopment: false,
          storageKind: 'directory'
        }
      ]
    })
  )
  env.close()
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
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
    const host = await app.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    await host.evaluate(() => {
      const field = document.querySelector('.search-input') as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        field,
        '200000×1.5'
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const row = host.locator('.quick-calculation')
    await expect(row).toContainText('200000*1.5 = 300,000')
    await expect(row).toContainText('回车进入稿纸')
    // Retry the shortcut until the plugin's regex features have been registered; once the paper
    // opens, the host leaves search view and further key events no longer reach the results.
    await expect
      .poll(
        async () => {
          await host.evaluate(() =>
            document.querySelector('.search-input')?.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true
              })
            )
          )
          return inPaper(app!, 'document.querySelectorAll(".calc textarea").length')
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0)
    await expect
      .poll(() =>
        inPaper(
          app!,
          '[...document.querySelectorAll(".calc textarea")].map((item) => item.value).join("|")'
        )
      )
      .toContain('200000*1.5')
    await expect
      .poll(() =>
        inPaper(
          app!,
          '[...document.querySelectorAll(".calc .result")].map((item) => item.textContent.trim()).join("|")'
        )
      )
      .toContain('300,000')
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((win) => win.isVisible())
      )
    ).toBe(false)
  } finally {
    await app?.close()
  }
})
