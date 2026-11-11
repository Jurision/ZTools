import { expect, test, _electron as electron, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FAKE_DISK, startFakeEverything } from '../helpers/fakeEverything'

const projectRoot = path.resolve(__dirname, '../..')
test.use({ screenshot: 'off', trace: 'off' })

/**
 * Set the hidden search input using DOM events only.
 * @param page Isolated renderer.
 * @param text Search text.
 * @returns Completes after input dispatch.
 */
async function input(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const field = document.querySelector('.search-input') as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
}

/**
 * Activate a renderer control without moving the physical mouse or focusing a native window.
 * @param page Isolated renderer.
 * @param selector Unique control selector.
 * @returns Completes after DOM click.
 */
async function click(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((element) => (element as HTMLElement).click())
}

/**
 * Forward a synthetic keyboard event to the hidden search box.
 * @param page Isolated renderer.
 * @param key Key name.
 * @param modifiers Shortcut modifiers.
 * @returns Completes after dispatch.
 */
async function key(
  page: Page,
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}
): Promise<void> {
  await page.locator('.search-input').evaluate(
    (element, event) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { ...event, bubbles: true, cancelable: true })
      )
    },
    { key, ...modifiers }
  )
}

test('isolated file search ranking, navigation, filters and safe actions', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-file-search-'))
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
    const host = await app.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    // Replace every externally visible action before entering a query; queries use only the fake HTTP index.
    await app.evaluate(({ ipcMain }) => {
      const state = {
        opens: [] as unknown[],
        copies: [] as string[],
        menus: [] as any[],
        queries: [] as string[],
        pending: {} as Record<string, (value: unknown) => void>
      }
      ;(globalThis as any).__fileTest = state
      ipcMain.removeHandler('file-search:open')
      ipcMain.handle('file-search:open', (_event, target, reveal) => {
        state.opens.push({ target, reveal })
        return { success: true }
      })
      ipcMain.removeHandler('copy-to-clipboard')
      ipcMain.handle('copy-to-clipboard', (_event, value) => {
        state.copies.push(value)
        return true
      })
      ipcMain.removeHandler('show-context-menu')
      ipcMain.handle('show-context-menu', (_event, menu) => {
        state.menus.push(menu)
      })
      ipcMain.removeHandler('search:translate-input')
      ipcMain.handle('search:translate-input', () => ({ text: '' }))
      ipcMain.removeHandler('get-apps')
      ipcMain.handle('get-apps', () => [{ name: '家人助手', path: 'C:/Fixture/family.exe' }])
    })
    await host.reload()
    await expect(host.locator('.search-input')).toBeAttached()
    await input(host, '家人')
    const rows = host.locator('.file-result')
    await expect(rows).toHaveCount(5)
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: '家人助手' }).first()
    ).toBeAttached()
    expect(
      await host.evaluate(() =>
        Boolean(
          document
            .querySelector('.app-item, .list-item')!
            .compareDocumentPosition(document.querySelector('.file-results')!) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      )
    ).toBe(true)
    for (const row of await rows.all())
      expect(await row.locator('.file-result-path').textContent()).toBe(
        await row.getAttribute('data-path')
      )
    await click(host, '.file-more')
    await expect(host.locator('.file-search-page')).toBeAttached()
    await expect(host.locator('.search-input')).toHaveValue('f 家人')
    await expect(host.locator('.translation-shortcut-hint')).toHaveCount(0)
    await expect(rows).toHaveCount(6)
    await input(host, '')
    await input(host, 'f 家人')
    await expect(rows).toHaveCount(6)
    await expect(rows.filter({ hasText: '家里人.jpg' })).toHaveCount(1)
    expect(await rows.allTextContents()).not.toEqual(
      expect.arrayContaining([expect.stringContaining('System32')])
    )

    let count = everything.searches.length
    await click(host, '[data-mode="exact"]')
    await expect(rows).toHaveCount(5)
    await expect(rows.filter({ hasText: '家里人.jpg' })).toHaveCount(0)
    expect(everything.searches.length).toBeGreaterThan(count)
    await click(host, '[data-mode="fuzzy"]')
    await expect(rows).toHaveCount(6)
    const closedHeight = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().height
    )
    await click(host, '.file-type-toggle')
    await expect(host.locator('.file-type-panel')).toBeAttached()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().height)
      )
      .toBeGreaterThan(closedHeight)
    const colors: string[] = []
    for (const colorScheme of ['light', 'dark'] as const) {
      await host.emulateMedia({ colorScheme })
      await expect(host.locator('.file-result-path').first()).toBeVisible()
      colors.push(
        await host
          .locator('.file-result-path')
          .first()
          .evaluate((element) => getComputedStyle(element).color)
      )
      await host.screenshot({ path: testInfo.outputPath(`file-search-${colorScheme}.png`) })
    }
    expect(colors[0]).not.toBe(colors[1])
    await host.emulateMedia({ colorScheme: 'light' })
    count = everything.searches.length
    await click(host, '[data-type="folder"]')
    await expect(rows).toHaveCount(3)
    expect(everything.searches.length).toBeGreaterThan(count)
    await click(host, '.file-type-clear')
    await expect(rows).toHaveCount(6)
    count = everything.searches.length
    await click(host, '[data-sort="recent"]')
    await expect(rows.first()).toContainText('收入倍增')
    expect(everything.searches.length).toBeGreaterThan(count)
    await click(host, '[data-sort="relevance"]')
    await expect(rows.first().locator('.file-result-name')).toHaveText('家人')
    await click(host, '.file-type-toggle')
    await expect(host.locator('.file-type-panel')).toHaveCount(0)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().height)
      )
      .toBe(closedHeight)

    const first = await rows.first().getAttribute('data-path')
    await key(host, 'Enter')
    await key(host, 'Enter', { ctrlKey: true })
    await key(host, 'c', { ctrlKey: true, shiftKey: true })
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.opens))
      .toEqual([
        { target: first, reveal: false },
        { target: first, reveal: true }
      ])
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.copies))
      .toEqual([first])
    await key(host, 'ArrowDown')
    await expect(rows.nth(1)).toHaveClass(/selected/)
    await key(host, 'Enter')
    const second = await rows.nth(1).getAttribute('data-path')
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.opens.at(-1)))
      .toEqual({ target: second, reveal: false })
    await rows.first().dispatchEvent('contextmenu')
    const menu = await app.evaluate(() => (globalThis as any).__fileTest.menus.at(-1))
    expect(menu.map((item: any) => item.label)).toEqual(['打开', '打开所在文件夹', '复制路径'])
    for (const item of menu)
      await app.evaluate(
        ({ BrowserWindow }, id) =>
          BrowserWindow.getAllWindows()[0].webContents.send('context-menu-command', id),
        item.id
      )
    await expect.poll(() => app.evaluate(() => (globalThis as any).__fileTest.opens.length)).toBe(5)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.copies.length))
      .toBe(2)

    // Resolve an obsolete IPC reply during the next query's debounce interval.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('file-search:query')
      ipcMain.handle('file-search:query', (_event, request) => {
        const state = (globalThis as any).__fileTest
        state.queries.push(request.query)
        return new Promise((resolve) => {
          state.pending[request.query] = resolve
        })
      })
    })
    await input(host, 'f 旧查询')
    await expect(rows).toHaveCount(0)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.queries))
      .toContain('旧查询')
    await input(host, 'f 新查询')
    await app.evaluate(() =>
      (globalThis as any).__fileTest.pending['旧查询']({
        status: 'ok',
        total: 1,
        items: [
          {
            name: '过期结果',
            path: 'C:\\fixture\\old.txt',
            dir: 'C:\\fixture',
            isFolder: false,
            score: 0
          }
        ]
      })
    )
    await expect(rows).toHaveCount(0)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.queries))
      .toContain('新查询')
    await app.evaluate(() =>
      (globalThis as any).__fileTest.pending['新查询']({
        status: 'ok',
        total: 1,
        items: [
          {
            name: '当前结果',
            path: 'C:\\fixture\\new.txt',
            dir: 'C:\\fixture',
            isFolder: false,
            score: 0
          }
        ]
      })
    )
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('当前结果')

    // Persist the disabled value in the isolated profile and send the same event used by Settings.
    const queryCountBeforeDisable = await app.evaluate(
      () => (globalThis as any).__fileTest.queries.length
    )
    await host.evaluate(async () => {
      const settings = (await window.ztools.dbGet('settings-general')) || {}
      await window.ztools.dbPut('settings-general', {
        ...settings,
        fileSearch: { enabled: false, excludes: [] }
      })
    })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('update-file-search-settings', {
        enabled: false,
        excludes: []
      })
    )
    await input(host, '家人')
    await expect(rows).toHaveCount(0)
    await expect(host.locator('.file-more')).toHaveCount(0)
    // Observe beyond the 150 ms debounce, so absence cannot be explained by a pending request.
    await host.waitForTimeout(300)
    expect(await app.evaluate(() => (globalThis as any).__fileTest.queries.length)).toBe(
      queryCountBeforeDisable
    )
    await host.reload()
    await expect(host.locator('.search-input')).toBeAttached()
    await input(host, '家人')
    await expect(rows).toHaveCount(0)
    await host.waitForTimeout(300)
    expect(await app.evaluate(() => (globalThis as any).__fileTest.queries.length)).toBe(
      queryCountBeforeDisable
    )
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
