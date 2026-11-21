import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

for (const directExit of [false, true]) {
  test(`hidden runtime ${directExit ? 'direct exit' : 'idle and normal quit'} releases subscriptions`, async () => {
    const soakMs = directExit ? 0 : Number(process.env.ZTOOLS_STABILITY_TEST_MS || 1000)
    test.setTimeout(soakMs + 90_000)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-runtime-lifecycle-'))
    const legacy = path.join(root, 'legacy')
    await fs.mkdir(legacy)
    let application: ElectronApplication | undefined
    try {
      application = await electron.launch({
        args: [projectRoot],
        cwd: projectRoot,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter((e): e is [string, string] => Boolean(e[1]))
          ),
          ZTOOLS_E2E: '1',
          ZTOOLS_BACKGROUND_TEST: '1',
          ZTOOLS_DATA_ROOT: root,
          ZTOOLS_LEGACY_USER_DATA_PATH: legacy,
          ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
        }
      })
      const page = await application.firstWindow()
      const child = application.process()
      await expect(page.locator('.search-input')).toBeAttached()
      await application.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('get-apps')
        ipcMain.handle('get-apps', () => [
          { name: 'Lifecycle Fixture', path: 'C:/Fixture/app.exe' }
        ])
      })
      await page.reload()
      const start = Date.now()
      do {
        // Exercise renderer/main IPC throughout the idle interval, without OS focus or real indexing.
        await page.locator('.search-input').fill('Lifecycle')
        await expect(
          page.locator('.app-item').filter({ hasText: 'Lifecycle Fixture' })
        ).toHaveCount(1)
        expect(
          await application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some((w) => w.isVisible() || w.isFocused())
          )
        ).toBe(false)
        if (Date.now() - start < soakMs)
          await page.waitForTimeout(Math.min(5000, soakMs - (Date.now() - start)))
      } while (Date.now() - start < soakMs)

      if (directExit) {
        const closed = application.waitForEvent('close')
        await application.evaluate(() => {
          setTimeout(() => process.exit(0), 50)
        })
        await closed
      } else {
        await application.close()
      }
      expect(child.exitCode).toBe(0)
      const rows = (await fs.readFile(path.join(root, 'logs', 'runtime-lifecycle.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const phases = rows.map((row) => row.phase)
      expect(phases[0]).toBe('started')
      expect(phases.at(-1)).toBe('exit')
      expect(rows.at(-1).exitCode).toBe(0)
      if (!directExit) {
        expect(phases.indexOf('listeners-stopped')).toBeGreaterThan(
          phases.indexOf('quit-requested')
        )
        expect(phases.indexOf('will-quit')).toBeGreaterThan(phases.indexOf('listeners-stopped'))
      }
      console.log(
        `Lifecycle validation: mode=${directExit ? 'direct-exit' : 'normal'} elapsedMs=${Date.now() - start} exitCode=0`
      )
      application = undefined
    } finally {
      await application?.close()
    }
  })
}
