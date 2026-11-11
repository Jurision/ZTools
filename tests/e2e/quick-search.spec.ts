import { expect, test, _electron as electron, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const projectRoot = path.resolve(__dirname, '../..')
test.use({ screenshot: 'off', trace: 'off' })

/**
 * Change only the hidden renderer input through DOM events, without desktop focus or typing.
 * @param page Isolated host renderer.
 * @param text Search text.
 * @returns Resolves after the input event is dispatched.
 */
async function input(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const field = document.querySelector('.search-input') as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
}

/**
 * Dispatch a synthetic key inside the hidden renderer, never at the operating-system level.
 * @param page Isolated host renderer.
 * @param key Key name.
 * @param modifiers Optional shortcut modifiers.
 * @returns Resolves after DOM dispatch.
 */
async function key(
  page: Page,
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}
): Promise<void> {
  await page.evaluate(
    (event) => {
      document
        .querySelector('.search-input')!
        .dispatchEvent(new KeyboardEvent('keydown', { ...event, bubbles: true, cancelable: true }))
    },
    { key, ...modifiers }
  )
}

test('quick search calculations and translations work in a hidden isolated source runtime', async () => {
  test.setTimeout(120_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-quick-search-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  await fs.mkdir(legacyRoot)
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
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
  try {
    const host = await app.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    // All external effects are replaced BEFORE text entry: no translation traffic, clipboard writes or app launches.
    await app.evaluate(({ ipcMain }) => {
      const state = {
        clipboard: null as null | { type: string; data: string },
        clipboardReads: 0,
        fileQueries: 0,
        copies: [] as string[],
        requests: [] as string[],
        providers: [] as string[],
        settingsOpened: 0,
        launches: 0
      }
      ;(globalThis as any).__quickSearchTest = state
      ipcMain.removeHandler('search:translate-input')
      ipcMain.handle(
        'search:translate-input',
        (_event, text: string, options?: { providerId?: string }) => {
          state.requests.push(text)
          state.providers.push(options?.providerId || '')
          if (text === 'missing keys')
            return { text: '', error: '请配置翻译服务', needsConfiguration: true }
          if (options?.providerId === 'builtin-openai-translation')
            return { text: text.includes('你好') ? 'Hello, world' : '世界你好' }
          return {
            text: text.includes('你好') ? 'Hello world' : '你好，世界',
            phonetic: '/həˈləʊ/',
            meanings: ['问候', '招呼']
          }
        }
      )
      ipcMain.removeHandler('get-last-copied-content')
      ipcMain.handle('get-last-copied-content', () => {
        state.clipboardReads++
        return state.clipboard
      })
      ipcMain.removeHandler('file-search:query')
      ipcMain.handle('file-search:query', () => {
        state.fileQueries++
        return { status: 'ok', total: 0, items: [] }
      })
      ipcMain.removeHandler('copy-to-clipboard')
      ipcMain.handle('copy-to-clipboard', (_event, text: string) => {
        state.copies.push(text)
        return true
      })
      ipcMain.removeAllListeners('open-translation-settings')
      ipcMain.on('open-translation-settings', () => {
        state.settingsOpened++
      })
      ipcMain.removeHandler('launch')
      ipcMain.handle('launch', () => {
        state.launches++
        return true
      })
      ipcMain.removeHandler('get-apps')
      ipcMain.handle('get-apps', () => [
        { name: 'Hello World Editor', path: 'C:/Fixture/hello.exe' },
        { name: '你好助手', path: 'C:/Fixture/nihao.exe' },
        { name: 'Hello World Document', path: 'C:/Fixture/hello.pdf', searchSource: 'files' },
        { name: 'Hello World Settings', path: 'ms-settings:display' }
      ])
    })
    await host.reload()
    await expect(host.locator('.search-input')).toBeAttached()
    await expect(
      host.locator('.placeholder-text, .translation-shortcut-hint, .tab-target-hint')
    ).toHaveCount(0)
    await input(host, 'hello')
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: 'Hello World Editor' }).first()
    ).toBeVisible()
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: 'Hello World Document' })
    ).toHaveCount(0)
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: 'Hello World Settings' })
    ).toHaveCount(0)
    await expect(host.locator('.search-translation')).toHaveCount(0)

    await expect(host.locator('.translation-shortcut-hint, .tab-target-hint')).toHaveCount(0)
    await host.waitForTimeout(250)
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.fileQueries)).toBe(0)
    // Ordinary reopening clears old text without reading or prefilling the native clipboard.
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__quickSearchTest
      state.clipboard = { type: 'text', data: 'old clipboard text' }
      BrowserWindow.getAllWindows()[0].webContents.send('search-session-start')
      BrowserWindow.getAllWindows()[0].webContents.send('focus-search', null)
    })
    await expect(host.locator('.search-input')).toHaveValue('')
    await expect(host.locator('.pasted-text')).toHaveCount(0)
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.clipboardReads)).toBe(0)
    // A delayed refocus within the same session must not erase newly typed text.
    await input(host, 'hello')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('focus-search', null)
    )
    await expect(host.locator('.search-input')).toHaveValue('hello')
    await input(host, '0.1+0.2')
    await expect(host.locator('.quick-calculation')).toContainText('0.3')
    expect(
      await host.locator('.scrollable-content > :first-child').getAttribute('class')
    ).toContain('quick-calculation')
    // This isolated profile has no paper plugin: Enter must not silently copy or launch an app.
    await key(host, 'Enter')
    await expect(host.locator('.quick-calculation')).toContainText('未找到计算稿纸插件')
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.copies)).toEqual([])
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.launches)).toBe(0)
    await key(host, 'Enter', { ctrlKey: true })
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__quickSearchTest.copies))
      .toEqual(['0.3'])
    await expect(host.locator('.quick-calculation')).toContainText('已复制')
    await input(host, '1/0')
    await expect(host.locator('.quick-calculation')).toHaveCount(0)

    // Typing never translates by itself, even a natural sentence.
    await input(host, 'hello world')
    await host.waitForTimeout(550)
    await expect(host.locator('.search-translation')).toHaveCount(0)
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.requests)).toEqual([])
    // A quick double Space translates with both services; the typed trailing space is removed.
    await input(host, 'hello world ')
    await key(host, ' ')
    await key(host, ' ')
    await expect(host.locator('.search-input')).toHaveValue('hello world')
    const youdao = host.locator('.search-translation[data-provider="builtin-youdao"]')
    const openai = host.locator('.search-translation[data-provider="builtin-openai-translation"]')
    await expect(youdao).toContainText('有道')
    await expect(youdao).toContainText('你好，世界')
    await expect(youdao).toContainText('/həˈləʊ/')
    await expect(youdao).toContainText('问候；招呼')
    await expect(openai).toContainText('OpenAI')
    await expect(openai).toContainText('世界你好')
    expect(
      (await app.evaluate(() => (globalThis as any).__quickSearchTest.providers)).sort()
    ).toEqual(['builtin-openai-translation', 'builtin-youdao'])
    await openai.evaluate((element: HTMLElement) => element.click())
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__quickSearchTest.copies.at(-1)))
      .toBe('世界你好')
    // Editing the text drops the now-stale translation.
    await input(host, 'hello worl')
    await expect(host.locator('.search-translation')).toHaveCount(0)
    await input(host, 'hello world ')
    await key(host, ' ')
    await key(host, ' ')
    await expect(youdao).toContainText('你好，世界')
    expect(
      await host.evaluate(() => {
        const application = document.querySelector('.app-item, .list-item')!
        const translation = document.querySelector('.search-translation')!
        return Boolean(
          application.compareDocumentPosition(translation) & Node.DOCUMENT_POSITION_FOLLOWING
        )
      })
    ).toBe(true)
    await input(host, '你好世界 ')
    await key(host, ' ')
    await key(host, ' ')
    await expect(youdao).toContainText('Hello world')
    await expect(openai).toContainText('Hello, world')

    await input(host, 'missing keys ')
    await key(host, ' ')
    await key(host, ' ')
    // With no configured service, a single row leads to the settings.
    await expect(host.locator('.search-translation')).toHaveCount(1)
    await expect(host.locator('.search-translation')).toContainText('回车打开翻译设置')
    await host.locator('.search-translation').evaluate((element: HTMLElement) => element.click())
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__quickSearchTest.settingsOpened))
      .toBe(1)

    // Exercise the same live settings broadcast used after saving the independent feature toggles.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update-quick-search-settings', {
        autoCalculate: false,
        autoTranslate: false
      })
    })
    await input(host, '4+5')
    await expect(host.locator('.quick-calculation')).toHaveCount(0)
    const before = await app.evaluate(() => (globalThis as any).__quickSearchTest.requests.length)
    await input(host, 'bonjour')
    await host.waitForTimeout(550)
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.requests.length)).toBe(
      before
    )
    await key(host, 'T', { ctrlKey: true, shiftKey: true })
    await expect(youdao).toContainText('你好，世界')
    await expect(openai).toContainText('世界你好')
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.requests.at(-1))).toBe(
      'bonjour'
    )
    // Plain pasted text stays in the query, and paragraphs stay as a block; neither is sent automatically.
    await input(host, '')
    await app.evaluate(() => {
      ;(globalThis as any).__quickSearchTest.clipboard = { type: 'text', data: 'hello' }
    })
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.search-input')).toHaveValue('hello')
    await expect(host.locator('.pasted-text')).toHaveCount(0)
    const requestsBeforePaste = await app.evaluate(
      () => (globalThis as any).__quickSearchTest.requests.length
    )
    await input(host, '')
    await app.evaluate(() => {
      ;(globalThis as any).__quickSearchTest.clipboard = {
        type: 'text',
        data: 'hello world\nsecond line'
      }
    })
    await host.locator('.search-input').dispatchEvent('paste')
    await expect(host.locator('.pasted-text')).toHaveCount(1)
    await host.waitForTimeout(550)
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.requests.length)).toBe(
      requestsBeforePaste
    )
    await key(host, 'T', { ctrlKey: true, shiftKey: true })
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__quickSearchTest.requests.length))
      .toBeGreaterThan(requestsBeforePaste)
    // Custom settings apply live and disable the old shortcut and both repeated-Space gestures.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.send('search-session-start')
      contents.send('update-quick-search-settings', {
        autoCalculate: true,
        triggers: {
          translate: { spaceCount: 0, shortcut: 'Ctrl+Shift+Y' },
          files: { spaceCount: 0, shortcut: 'Ctrl+Shift+F' }
        }
      })
    })
    await input(host, 'custom phrase')
    const customBefore = await app.evaluate(
      () => (globalThis as any).__quickSearchTest.requests.length
    )
    await key(host, 'T', { ctrlKey: true, shiftKey: true })
    await input(host, 'custom phrase ')
    await key(host, ' ')
    await key(host, ' ')
    await key(host, ' ')
    await host.waitForTimeout(450)
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.requests.length)).toBe(
      customBefore
    )
    await expect(host.locator('.file-search-page')).toHaveCount(0)
    await key(host, 'Y', { ctrlKey: true, shiftKey: true })
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__quickSearchTest.requests.length))
      .toBeGreaterThan(customBefore)
    await input(host, 'file query')
    const beforeFiles = await app.evaluate(
      () => (globalThis as any).__quickSearchTest.requests.length
    )
    await key(host, 'F', { ctrlKey: true, shiftKey: true })
    await expect(host.locator('.file-search-page')).toBeAttached()
    await expect(host.locator('.search-input')).toHaveValue('file query')
    await key(host, 'Y', { ctrlKey: true, shiftKey: true })
    expect(await app.evaluate(() => (globalThis as any).__quickSearchTest.requests.length)).toBe(
      beforeFiles
    )
    expect(
      await app.evaluate(({ BrowserWindow, app }) => ({
        visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
        focused: BrowserWindow.getFocusedWindow() !== null,
        root: app.getPath('userData'),
        launches: (globalThis as any).__quickSearchTest.launches
      }))
    ).toEqual({ visible: false, focused: false, root: dataRoot, launches: 0 })
  } finally {
    await app.close()
  }
})
