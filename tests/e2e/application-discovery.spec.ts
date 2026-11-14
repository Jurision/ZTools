import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isSearchCommandVisible, normalizeSearchSources } from '../../src/shared/searchSources'

const projectRoot = path.resolve(__dirname, '../..')
test.use({ screenshot: 'off', trace: 'off' })

test('final application grid preserves one installed product per row across names and refreshes', async () => {
  test.setTimeout(240_000)
  // A read-only diagnostic may supply an ignored snapshot; this test never opens the live profile.
  const snapshot = process.env.ZTOOLS_APP_REPLAY_PATH
    ? JSON.parse(
        (await fs.readFile(process.env.ZTOOLS_APP_REPLAY_PATH, 'utf8')).replace(/^\uFEFF/, '')
      )
    : {
        apps: [
          {
            name: '星云',
            path: 'C:/Fixture/星云.lnk',
            targetPath: 'D:/Fixture/Nebula.exe',
            aliases: [
              'Nebula',
              'Nebula 2.0',
              'Nebula Professional Application with a Long Registered Name'
            ],
            sourcePaths: ['D:/Fixture/app/Nebula.exe'],
            launchSignature: 'default',
            argumentSignature: 'default'
          },
          {
            name: '星云工作',
            path: 'C:/Fixture/星云工作.lnk',
            targetPath: 'D:/Fixture/Work.exe',
            launchSignature: 'default'
          },
          { name: 'Other Version', path: 'D:/Other/Nebula.exe' }
        ],
        local: [{ name: 'Nebula', path: 'D:/Fixture/app/Nebula.exe' }]
      }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-application-grid-'))
  const legacy = path.join(root, 'legacy')
  await fs.mkdir(legacy)
  const app = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      ZTOOLS_E2E: '1',
      ZTOOLS_BACKGROUND_TEST: '1',
      ZTOOLS_DATA_ROOT: root,
      ZTOOLS_LEGACY_USER_DATA_PATH: legacy,
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
  let queries = 0
  try {
    const host = await app.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    await app.evaluate(({ ipcMain }, data) => {
      const effects = { launches: 0, translations: 0, clipboardReads: 0 }
      ;(globalThis as any).__applicationAudit = effects
      for (const name of [
        'get-apps',
        'local-shortcuts:get-all',
        'launch',
        'search:translate-input',
        'file-search:query',
        'get-last-copied-content'
      ])
        ipcMain.removeHandler(name)
      ipcMain.handle('get-apps', () => data.apps)
      ipcMain.handle('local-shortcuts:get-all', () => data.local)
      ipcMain.handle('launch', () => {
        effects.launches++
        return true
      })
      ipcMain.handle('search:translate-input', () => {
        effects.translations++
        return { text: 'unexpected request' }
      })
      ipcMain.handle('file-search:query', () => ({ status: 'ok', total: 0, items: [] }))
      ipcMain.handle('get-last-copied-content', () => {
        effects.clipboardReads++
        return null
      })
    }, snapshot)
    await host.reload()
    await expect(host.locator('.search-input')).toBeAttached()
    const visible = snapshot.apps.filter((entry: any) =>
      isSearchCommandVisible({ ...entry, type: 'direct', subType: 'app' }, normalizeSearchSources())
    )
    const names = new Map<string, number>()
    for (const entry of visible) names.set(entry.name, (names.get(entry.name) || 0) + 1)
    const probes = new Map<string, string>()
    for (const entry of visible)
      for (const label of [entry.name, ...(entry.aliases || [])])
        if (label.trim()) probes.set(label, entry.name)
    for (const [query, name] of probes) {
      await host.evaluate((value) => {
        const field = document.querySelector('.search-input') as HTMLInputElement
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          field,
          value
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }, query)
      const rows = host.locator('.app-item, .list-item').and(host.getByTitle(name, { exact: true }))
      if (query === name)
        await expect(rows, `query ${query}: canonical row ${name}`).toHaveCount(names.get(name)!)
      else
        await expect
          .poll(
            async () => {
              const count = await rows.count()
              return count >= 1 && count <= names.get(name)!
            },
            { message: `alias ${query}: canonical row ${name}` }
          )
          .toBe(true)
      queries++
    }
    // The user's reported broad pinyin query checks actual visible titles, not a cache identity count.
    if (process.env.ZTOOLS_APP_REPLAY_PATH) {
      await host.evaluate(() => {
        const field = document.querySelector('.search-input') as HTMLInputElement
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          field,
          'dou'
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await expect
        .poll(() =>
          host
            .locator('.app-item, .list-item')
            .evaluateAll((rows) => rows.map((row) => row.getAttribute('title')).sort())
        )
        .toEqual(['抖音', '豆包', '豆包工作'].sort())
    }
    expect(
      await app.evaluate(({ BrowserWindow, app }) => ({
        effects: (globalThis as any).__applicationAudit,
        visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
        focused: !!BrowserWindow.getFocusedWindow(),
        root: app.getPath('userData')
      }))
    ).toEqual({
      effects: { launches: 0, translations: 0, clipboardReads: 0 },
      visible: false,
      focused: false,
      root
    })
    console.log(
      `Application grid audit: ${visible.length} entries, ${queries} name/alias searches; no desktop input or external requests.`
    )
  } finally {
    await app.close()
  }
})
