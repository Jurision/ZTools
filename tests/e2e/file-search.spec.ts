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

/**
 * Change the hidden sort selector without opening a native select popup.
 * @param page Isolated host.
 * @param value Sort value.
 * @returns Resolves after the change event.
 */
async function sort(page: Page, value: string): Promise<void> {
  await page.locator('select[aria-label="排序方式"]').evaluate((element, next) => {
    ;(element as HTMLSelectElement).value = next
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

// eslint-disable-next-line no-empty-pattern -- Source Electron needs testInfo without browser fixtures.
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
        translations: [] as string[],
        clipboard: null as null | { type: string; data: string },
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
      ipcMain.handle('search:translate-input', (_event, text) => {
        state.translations.push(text)
        return { text: '' }
      })
      ipcMain.removeHandler('get-last-copied-content')
      ipcMain.handle('get-last-copied-content', () => state.clipboard)
      ipcMain.removeHandler('get-apps')
      ipcMain.handle('get-apps', () => [{ name: '家人助手', path: 'C:/Fixture/family.exe' }])
    })
    await host.reload()
    await expect(host.locator('.search-input')).toBeAttached()
    await expect(host.locator('.file-fold')).toHaveCount(0)
    await input(host, '家人')
    const rows = host.locator('.file-result')
    await expect(rows).toHaveCount(0)
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: '家人助手' }).first()
    ).toBeAttached()
    await expect.poll(() => everything.searches.length).toBeGreaterThan(0)
    const fold = host.locator('.file-fold')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await expect(fold).toHaveText('')
    await expect(host.locator('.file-search-page, .file-toolbar')).toHaveCount(0)
    // Exercise the app context menu and real host-only persistence in the temporary profile.
    await host.locator('.app-item').filter({ hasText: '家人助手' }).dispatchEvent('contextmenu')
    const appHide = await app.evaluate(() =>
      (globalThis as any).__fileTest.menus
        .at(-1)
        .find((entry: any) => entry.id?.startsWith('hide-search-app:'))
    )
    expect(appHide.label).toBe('从搜索结果中隐藏')
    await app.evaluate(
      ({ BrowserWindow }, id) =>
        BrowserWindow.getAllWindows()[0].webContents.send('context-menu-command', id),
      appHide.id
    )
    await expect(host.locator('.app-item').filter({ hasText: '家人助手' })).toHaveCount(0)
    await host.reload()
    await expect(host.locator('.search-input')).toBeAttached()
    await input(host, '家人')
    await expect(host.locator('.app-item').filter({ hasText: '家人助手' })).toHaveCount(0)
    const restoredSources = await host.evaluate(async () => {
      const settings = await window.ztools.dbGet('settings-general')
      const searchSources = { ...settings.searchSources, hiddenApplicationPaths: [] }
      await window.ztools.dbPut('settings-general', { ...settings, searchSources })
      return searchSources
    })
    await app.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()[0].webContents.send('update-search-sources', value),
      restoredSources
    )
    await expect(host.locator('.app-item').filter({ hasText: '家人助手' })).toHaveCount(1)
    // Keyboard navigation never opens a hidden file: the disclosure must be expanded first.
    await key(host, 'ArrowDown')
    await expect(fold).toHaveClass(/selected/)
    await key(host, 'Enter')
    await expect(rows).toHaveCount(6)
    await expect(host.locator('.file-search-page')).toHaveCount(0)
    await expect(host.locator('.search-input')).toHaveValue('家人')
    await key(host, 'ArrowDown')
    const inlineFirst = await rows.first().getAttribute('data-path')
    await key(host, 'Enter')
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.opens.at(-1)))
      .toEqual({ target: inlineFirst, reveal: false })
    await key(host, 'Enter', { ctrlKey: true })
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.opens.at(-1)))
      .toEqual({ target: inlineFirst, reveal: true })
    await key(host, 'c', { ctrlKey: true, shiftKey: true })
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.copies.at(-1)))
      .toBe(inlineFirst)
    await rows.first().dispatchEvent('contextmenu')
    const fileHide = await app.evaluate(() =>
      (globalThis as any).__fileTest.menus
        .at(-1)
        .find((entry: any) => entry.id?.startsWith('file-hide:'))
    )
    await app.evaluate(
      ({ BrowserWindow }, id) =>
        BrowserWindow.getAllWindows()[0].webContents.send('context-menu-command', id),
      fileHide.id
    )
    await expect(rows).toHaveCount(5)
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-path'))
      )
    ).not.toContain(inlineFirst)
    await host.reload()
    await expect(host.locator('.search-input')).toBeAttached()
    await input(host, '家人')
    await click(host, '.file-fold')
    await expect(rows).toHaveCount(5)
    await click(host, '.file-page-link')
    await expect(rows).toHaveCount(5)
    // Restore using the same persisted fields and notification as the Settings page.
    const restoredFiles = await host.evaluate(async () => {
      const settings = await window.ztools.dbGet('settings-general')
      const fileSearch = { ...settings.fileSearch, hiddenPaths: [] }
      await window.ztools.dbPut('settings-general', { ...settings, fileSearch })
      return fileSearch
    })
    await app.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()[0].webContents.send('update-file-search-settings', value),
      restoredFiles
    )
    await expect(rows).toHaveCount(6)
    await click(host, '.file-search-back')
    await click(host, '.file-fold')
    await expect(rows).toHaveCount(6)
    // Match the host in both themes; compact rows do not introduce their own panel background.
    for (const colorScheme of ['light', 'dark'] as const) {
      await host.emulateMedia({ colorScheme })
      const layout = await host.locator('.main-file-preview').evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        overflow: element.scrollWidth > element.clientWidth,
        height: element.getBoundingClientRect().height
      }))
      expect(layout.background).toBe('rgba(0, 0, 0, 0)')
      expect(layout.overflow).toBe(false)
      expect(layout.height).toBeGreaterThan(24)
    }
    await click(host, '.file-fold')
    await expect(rows).toHaveCount(0)
    await click(host, '.file-fold')
    await expect(rows).toHaveCount(6)
    await click(host, '.file-page-link')
    await expect(host.locator('.file-search-page')).toBeAttached()
    await expect(host.locator('.search-input')).toHaveValue('家人')
    await click(host, '.file-search-back')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await click(host, '.file-fold')
    // List mode shares the same disclosure and keeps the app selection separate from file rows.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('update-search-mode', 'list')
    )
    await expect(host.locator('.list-mode-results .list-item')).toHaveCount(1)
    await input(host, '家人 ')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await key(host, 'ArrowDown')
    await key(host, 'Enter')
    await expect(rows).toHaveCount(6)
    await key(host, 'ArrowDown')
    await expect(rows.first()).toHaveClass(/selected/)
    await expect(host.locator('.list-item.selected')).toHaveCount(0)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('update-search-mode', 'aggregate')
    )
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('search-session-start')
    )
    await expect(fold).toHaveCount(0)
    await input(host, '家人')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await input(host, '0.1+0.2')
    await expect(host.locator('.quick-calculation')).toContainText('0.3')
    await expect(fold).toHaveCount(0)
    await app.evaluate(() => {
      const state = (globalThis as any).__fileTest
      state.opens = []
      state.copies = []
    })
    await input(host, '家人 ')
    await key(host, ' ')
    await key(host, ' ')
    await key(host, ' ')
    await expect(host.locator('.file-search-page')).toBeAttached()
    await expect(host.locator('.search-input')).toHaveValue('家人')
    await expect(host.locator('.translation-shortcut-hint')).toHaveCount(0)
    await expect(rows).toHaveCount(6)
    await click(host, '.file-search-back')
    await input(host, '')
    await input(host, 'f 家人')
    await expect(host.locator('.search-input')).toHaveValue('家人')
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
      if (process.env.ZTOOLS_ALLOW_TEST_SCREENSHOTS === '1')
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
    await sort(host, 'recent')
    await click(host, '.file-sort-direction')
    await expect(rows.first()).toContainText('收入倍增')
    expect(everything.searches.length).toBeGreaterThan(count)
    await sort(host, 'relevance')
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
    expect(menu.map((item: any) => item.label)).toEqual([
      '打开',
      '打开所在文件夹',
      '复制路径',
      '从搜索结果中隐藏'
    ])
    for (const item of menu.filter((entry: any) => !entry.id.startsWith('file-hide:')))
      await app.evaluate(
        ({ BrowserWindow }, id) =>
          BrowserWindow.getAllWindows()[0].webContents.send('context-menu-command', id),
        item.id
      )
    await expect.poll(() => app.evaluate(() => (globalThis as any).__fileTest.opens.length)).toBe(5)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.copies.length))
      .toBe(2)

    // Each new summon starts an empty app query and resets type filters; file sorting survives.
    await sort(host, 'size')
    await expect(rows.first()).toContainText('收入倍增')
    await click(host, '.file-type-toggle')
    await click(host, '[data-type="program"]')
    await expect(rows).toHaveCount(0)
    await expect(host.locator('.file-clear-empty-filter')).toBeAttached()
    await click(host, '.file-clear-empty-filter')
    await expect(rows).toHaveCount(6)
    await click(host, '[data-type="folder"]')
    await expect(rows).toHaveCount(3)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('search-session-start')
    )
    await expect(host.locator('.search-input')).toHaveValue('')
    await expect(host.locator('.file-search-page')).toHaveCount(0)
    await input(host, 'f 家人')
    await expect(rows).toHaveCount(6)
    await expect(host.locator('select[aria-label="排序方式"]')).toHaveValue('size')
    await expect(host.locator('.file-sort-direction')).toContainText('降序')
    await click(host, '.file-search-back')
    await input(host, '家人')
    await expect(rows).toHaveCount(0)

    // Triple Space must never leak a translation request, including when text resembles English.
    const translationCount = await app.evaluate(
      () => (globalThis as any).__fileTest.translations.length
    )
    await input(host, 'report ')
    await key(host, ' ')
    await key(host, ' ')
    await key(host, ' ')
    await expect(host.locator('.search-input')).toHaveValue('report')
    await expect(host.locator('.file-search-page')).toBeAttached()
    await host.waitForTimeout(500)
    expect(await app.evaluate(() => (globalThis as any).__fileTest.translations.length)).toBe(
      translationCount
    )
    await key(host, ' ')
    await key(host, ' ')
    await host.waitForTimeout(450)
    expect(await app.evaluate(() => (globalThis as any).__fileTest.translations.length)).toBe(
      translationCount
    )

    // Clipboard reads are mocked; the native clipboard is never touched.
    await app.evaluate(() => {
      ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: '备份\\惠普备份\\家人' }
    })
    await input(host, '')
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue('备份\\惠普备份\\家人')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute('data-path', 'E:\\备份\\惠普备份\\家人')

    const explicitDirectory = path.join(dataRoot, 'Family Photos')
    const explicitPath = path.join(explicitDirectory, 'memo note.txt')
    await fs.mkdir(explicitDirectory)
    await fs.writeFile(explicitPath, 'isolated fixture only')
    await app.evaluate((_electron, target) => {
      ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: target }
    }, explicitPath)
    await input(host, '')
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue(explicitPath)
    await expect(rows.first()).toHaveAttribute('data-path', explicitPath)

    // Entering file search replaces previous image/file matching badges as well as text.
    for (const attachment of [
      { type: 'image', data: 'data:image/png;base64,iVBORw0KGgo=' },
      { type: 'file', data: [{ path: explicitPath, name: 'memo.txt', isDirectory: false }] }
    ]) {
      await click(host, '.file-search-back')
      await input(host, '')
      await app.evaluate((_electron, value) => {
        ;(globalThis as any).__fileTest.clipboard = value
      }, attachment)
      await host.locator('.search-input').dispatchEvent('paste')
      await expect(host.locator('.file-search-page')).toHaveCount(0)
      await expect(host.locator('.pasted-image-thumbnail, .pasted-files')).toHaveCount(1)
      await app.evaluate((_electron, target) => {
        ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: target }
      }, explicitPath)
      await host.locator('.search-input').dispatchEvent('paste')
      await expect(host.locator('.search-input')).toHaveValue(explicitPath)
      await expect(host.locator('.file-search-page')).toHaveCount(0)
      await input(host, explicitPath + ' ')
      await key(host, ' ')
      await key(host, ' ')
      await key(host, ' ')
      await expect(host.locator('.file-search-page')).toBeAttached()
      await expect(host.locator('.pasted-image-thumbnail, .pasted-files')).toHaveCount(0)
      await expect(rows.first()).toHaveAttribute('data-path', explicitPath)
    }

    // A path plus a filename searches all descendant levels, including after a literal path paste.
    const nestedQuery = 'D:\\APP\\Aurora\\Aurora mods.txt'
    const nestedTarget = 'D:\\APP\\Aurora\\Aurora\\Bin\\nte\\Lua\\ue4ss\\Mods\\mods.txt'
    for (const mode of ['fuzzy', 'exact']) {
      await click(host, `[data-mode="${mode}"]`)
      await input(host, nestedQuery)
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toHaveAttribute('data-path', nestedTarget)
      await app.evaluate((_electron, text) => {
        ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: text }
      }, nestedQuery)
      await input(host, '')
      await host.locator('.search-input').dispatchEvent('paste')
      await expect(host.locator('.search-input')).toHaveValue(nestedQuery)
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toHaveAttribute('data-path', nestedTarget)
    }
    await input(host, explicitPath)
    await expect(rows.first()).toHaveAttribute('data-path', explicitPath)

    // Pasting the legacy documentation example removes only its command marker, never adds quotes.
    const scopedQuery = '"D:\\Program Files\\Aurora\\" aurora'
    await app.evaluate((_electron, text) => {
      ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: text }
    }, 'f ' + scopedQuery)
    await input(host, '')
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue(scopedQuery)
    await expect(host.locator('.file-search-page')).toBeAttached()

    // Whole quoted paths keep their original quotes exactly; no synthetic F enters copied text.
    await click(host, '.file-search-back')
    await app.evaluate((_electron, text) => {
      ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: text }
    }, scopedQuery)
    await input(host, '')
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue(scopedQuery)
    await expect(host.locator('.file-search-page')).toHaveCount(0)
    await input(host, scopedQuery + ' ')
    await key(host, ' ')
    await key(host, ' ')
    await key(host, ' ')
    await expect(host.locator('.file-search-page')).toBeAttached()
    await app.evaluate((_electron, text) => {
      ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: text }
    }, `"${explicitPath}"`)
    await input(host, '')
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue(`"${explicitPath}"`)
    await expect(rows.first()).toHaveAttribute('data-path', explicitPath)

    // A partial selection is replaced in place, rather than replacing the entire search query.
    await input(host, 'before REPLACE after')
    await host
      .locator('.search-input')
      .evaluate((element) => (element as HTMLInputElement).setSelectionRange(7, 14))
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue(`before "${explicitPath}" after`)
    await input(host, 'suffix')
    await host
      .locator('.search-input')
      .evaluate((element) => (element as HTMLInputElement).setSelectionRange(0, 0))
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue(`"${explicitPath}"suffix`)
    await input(host, '')
    await app.evaluate(() => {
      ;(globalThis as any).__fileTest.clipboard = { type: 'text', data: '文件搜索文字' }
    })
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue('文件搜索文字')
    await expect(host.locator('.pasted-text')).toHaveCount(0)
    await key(host, 'Escape')
    await expect(host.locator('.search-input')).toHaveValue('')
    await expect(host.locator('.file-search-page')).toBeAttached()
    await key(host, 'Escape')
    await expect(host.locator('.file-search-page')).toHaveCount(0)
    await input(host, 'f ')

    await click(host, '[data-mode="exact"]')
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
    await input(host, '旧查询')
    await expect(rows).toHaveCount(0)
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__fileTest.queries))
      .toContain('旧查询')
    await input(host, '新查询')
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
    await click(host, '.file-search-back')
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
