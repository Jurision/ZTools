import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FAKE_DISK, startFakeEverything } from '../helpers/fakeEverything'

const projectRoot = path.resolve(__dirname, '../..')
test.use({ screenshot: 'off', trace: 'off' })

// eslint-disable-next-line no-empty-pattern -- Electron owns the renderer, not a browser fixture.
test('hidden search preserves native IME preedit across renders and commits', async ({}) => {
  test.setTimeout(90_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-ime-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  await fs.mkdir(legacyRoot)
  const everything = await startFakeEverything(FAKE_DISK, dataRoot)
  const app = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      ZTOOLS_E2E: '1',
      ZTOOLS_BACKGROUND_TEST: '1',
      ZTOOLS_DATA_ROOT: dataRoot,
      ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      ZTOOLS_EVERYTHING_INI: everything.iniPath,
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
  try {
    const page = await app.firstWindow()
    const input = page.locator('.search-input')
    await expect(input).toBeAttached()
    await input.evaluate((element) => {
      const field = element as HTMLInputElement
      field.focus()
      ;(window as any).__imeEvents = []
      for (const kind of ['compositionstart', 'compositionupdate', 'compositionend', 'input']) {
        field.addEventListener(kind, (event) => {
          ;(window as any).__imeEvents.push({
            type: event.type,
            data: (event as CompositionEvent).data,
            value: field.value
          })
        })
      }
    })
    await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(
        (window) => window.getTitle() === 'ZTools'
      )!.webContents
      contents.debugger.attach('1.3')
      await contents.debugger.sendCommand('Input.imeSetComposition', {
        text: '语音测试',
        selectionStart: 4,
        selectionEnd: 4
      })
    })
    await page.waitForTimeout(300)
    console.log('IME first preedit', await page.evaluate(() => (window as any).__imeEvents))
    await expect(input).toHaveValue('语音测试')
    // An unrelated parent state update must not write the committed value over preedit.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle() === 'ZTools')!
        .webContents.send('update-search-sources', { applications: true, plugins: false })
    })
    await page.waitForTimeout(150)
    await expect(input).toHaveValue('语音测试')
    await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(
        (window) => window.getTitle() === 'ZTools'
      )!.webContents
      await contents.debugger.sendCommand('Input.imeSetComposition', {
        text: '语音测试继续',
        selectionStart: 6,
        selectionEnd: 6
      })
    })
    await expect(input).toHaveValue('语音测试继续')
    await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(
        (window) => window.getTitle() === 'ZTools'
      )!.webContents
      await contents.debugger.sendCommand('Input.insertText', { text: '语音测试完成' })
      contents.debugger.detach()
    })
    await expect(input).toHaveValue('语音测试完成')
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  } finally {
    await app.close()
    await everything.close()
  }
})
