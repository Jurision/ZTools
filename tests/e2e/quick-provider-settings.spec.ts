import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * Evaluate fixture-only DOM operations inside the real hidden settings WebContentsView.
 * @param app Isolated source Electron instance.
 * @param script Controlled test expression, never user data.
 * @returns The settings renderer result, or null until that view exists.
 */
async function inSettings(app: ElectronApplication, script: string): Promise<any> {
  return app.evaluate(async ({ webContents }, source) => {
    const settings = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
    return settings ? settings.executeJavaScript(source) : null
  }, script)
}

/**
 * Fill only fixture credentials with renderer DOM events, without desktop typing or focus.
 * @param app Isolated source runtime.
 * @param provider Provider form test identifier.
 * @param values Fixture input values in label order.
 * @returns Completes after Vue has processed input events.
 */
async function fillProvider(
  app: ElectronApplication,
  provider: string,
  values: string[]
): Promise<void> {
  await inSettings(
    app,
    `(() => {
    const fields = document.querySelectorAll('[data-testid="${provider}"] input');
    const values = ${JSON.stringify(values)};
    fields.forEach((field, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, values[index]);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return true;
  })()`
  )
}

// eslint-disable-next-line no-empty-pattern -- Source Electron needs testInfo but no browser fixtures.
test('translation settings opens directly and saves isolated provider configuration without requests', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-provider-settings-'))
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
    await app.evaluate(({ net }) => {
      ;(globalThis as any).__providerFetchCount = 0
      net.fetch = async () => {
        ;(globalThis as any).__providerFetchCount++
        throw new Error('Online requests are forbidden in provider settings fixtures')
      }
    })
    // Exercise the actual host-validated IPC and settings plugin route protocol.
    await host.evaluate(() => (window as any).ztools.openTranslationSettings())
    await expect
      .poll(
        () =>
          inSettings(
            app,
            `document.querySelectorAll('[data-testid="youdao-translation-settings"], [data-testid="openai-translation-settings"]').length`
          ),
        { timeout: 30_000 }
      )
      .toBe(2)
    expect(
      await inSettings(app, `document.querySelector('.tab-btn.active')?.textContent.trim()`)
    ).toBe('翻译')
    expect(
      await inSettings(
        app,
        `document.querySelector('[data-testid="youdao-translation-settings"] .source-badge')?.textContent.trim()`
      )
    ).toBe('用于搜索翻译')
    expect(
      await inSettings(
        app,
        `Array.from(document.querySelectorAll('.online-card input[type="password"]')).length`
      )
    ).toBe(2)

    // Reopening through the host must override a manually selected tab in a cached view.
    await inSettings(app, `document.querySelectorAll('.tab-btn')[0].click()`)
    await expect
      .poll(() => inSettings(app, `document.querySelector('.tab-btn.active')?.textContent.trim()`))
      .toBe('AI')
    await host.evaluate(() => (window as any).ztools.openTranslationSettings())
    await expect
      .poll(() => inSettings(app, `document.querySelector('.tab-btn.active')?.textContent.trim()`))
      .toBe('翻译')

    await fillProvider(app, 'youdao-translation-settings', [
      'fixture-youdao-app',
      'fixture-youdao-secret-not-real'
    ])
    await inSettings(
      app,
      `document.querySelector('[data-testid="youdao-translation-settings"] button').click()`
    )
    await expect
      .poll(() =>
        inSettings(
          app,
          `(async () => (await window.ztools.internal.providers.getSettings()).data.params['builtin-youdao'])()`
        )
      )
      .toEqual({ appKey: 'fixture-youdao-app', appSecret: 'fixture-youdao-secret-not-real' })

    await fillProvider(app, 'openai-translation-settings', [
      'https://translation.example.test/v1',
      'fixture-openai-secret-not-real',
      'fixture-model'
    ])
    await inSettings(
      app,
      `document.querySelectorAll('[data-testid="openai-translation-settings"] button')[1].click()`
    )
    await expect
      .poll(() =>
        inSettings(
          app,
          `(async () => (await window.ztools.internal.providers.getSettings()).data.params['search-translation'])()`
        )
      )
      .toEqual({ providerId: 'builtin-openai-translation' })
    expect(
      await inSettings(
        app,
        `(async () => (await window.ztools.internal.providers.getSettings()).data.params['builtin-openai-translation'])()`
      )
    ).toEqual({
      baseUrl: 'https://translation.example.test/v1',
      apiKey: 'fixture-openai-secret-not-real',
      model: 'fixture-model'
    })
    expect(
      await inSettings(
        app,
        `document.querySelector('[data-testid="openai-translation-settings"] .source-badge')?.textContent.trim()`
      )
    ).toBe('用于搜索翻译')

    // Reload the actual view to prove persistence rather than reading component-local state.
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))!
        .reload()
    )
    await expect
      .poll(
        () =>
          inSettings(
            app,
            `document.querySelector('[data-testid="openai-translation-settings"] .source-badge')?.textContent.trim()`
          ),
        { timeout: 30_000 }
      )
      .toBe('用于搜索翻译')
    expect(
      await inSettings(
        app,
        `document.querySelectorAll('[data-testid="openai-translation-settings"] input')[2]?.value`
      )
    ).toBe('fixture-model')
    if (process.env.ZTOOLS_ALLOW_TEST_SCREENSHOTS === '1') {
      const png = await app.evaluate(async ({ webContents }) => {
        const settings = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))!
        return (await settings.capturePage()).toPNG().toString('base64')
      })
      await fs.writeFile(
        testInfo.outputPath('translation-provider-settings.png'),
        Buffer.from(png, 'base64')
      )
    }
    // Clear only device-local usage through the actual authorized Settings plugin IPC.
    const usageFixture = path.join(dataRoot, 'usage-fixture.txt')
    await fs.writeFile(usageFixture, 'fixture file must survive clearing usage')
    await host.evaluate(async (target) => {
      await window.ztools.dbPut('file-search-open-history', [
        { path: target, count: 3, lastOpened: Date.now(), indexed: false }
      ])
    }, usageFixture)
    await inSettings(
      app,
      `Array.from(document.querySelectorAll('.menu-item')).find(item => item.textContent.includes('通用设置')).click()`
    )
    await expect
      .poll(() =>
        inSettings(
          app,
          `Boolean(document.querySelector('[data-setting="clear-file-search-history"]'))`
        )
      )
      .toBe(true)
    const inputBefore = await host.evaluate(
      () => (document.querySelector('.search-input') as HTMLInputElement | null)?.value ?? null
    )
    const preferencesBefore = await host.evaluate(() => window.ztools.dbGet('settings-general'))
    await inSettings(
      app,
      `(() => {
      const field = document.querySelector('#file-search-excludes');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'fixture-unsaved-exclusion');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-setting="clear-file-search-history"]').click();
    })()`
    )
    await expect
      .poll(() => host.evaluate(() => window.ztools.dbGet('file-search-open-history')))
      .toEqual([])
    expect(await fs.readFile(usageFixture, 'utf8')).toBe('fixture file must survive clearing usage')
    expect(await inSettings(app, `document.querySelector('#file-search-excludes').value`)).toBe(
      'fixture-unsaved-exclusion'
    )
    expect(await host.evaluate(() => window.ztools.dbGet('settings-general'))).toEqual(
      preferencesBefore
    )
    expect(
      await host.evaluate(
        () => (document.querySelector('.search-input') as HTMLInputElement | null)?.value ?? null
      )
    ).toBe(inputBefore)

    // Exercise real settings controls and persisted IPC; no host or desktop key is pressed.
    expect(
      await inSettings(
        app,
        `document.querySelector('[data-setting="translate-space-count"]').value`
      )
    ).toBe('2')
    expect(
      await inSettings(app, `document.querySelector('[data-setting="files-space-count"]').value`)
    ).toBe('3')
    expect(
      await inSettings(app, `document.querySelector('[data-setting="translate-shortcut"]').value`)
    ).toBe('Ctrl+Shift+T')
    expect(
      await inSettings(app, `document.querySelector('[data-setting="files-shortcut"]').value`)
    ).toBe('')
    expect(
      await inSettings(app, `document.querySelector('.search-source-settings').textContent`)
    ).not.toContain('粘贴文字时自动翻译')
    await inSettings(
      app,
      `(() => {
      const select = document.querySelector('[data-setting="files-space-count"]');
      select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`
    )
    await inSettings(
      app,
      `Array.from(document.querySelectorAll('.search-source-settings button')).find(item => item.textContent.includes('保存搜索范围')).click()`
    )
    await expect
      .poll(() =>
        inSettings(
          app,
          `document.querySelector('.search-source-settings [role="status"]').textContent`
        )
      )
      .toContain('不能使用相同的空格次数')
    expect(await host.evaluate(() => window.ztools.dbGet('settings-general'))).toEqual(
      preferencesBefore
    )

    // Clear the repeated translation gesture, leaving its optional chord independent.
    await inSettings(
      app,
      `(() => {
      const select = document.querySelector('[data-setting="translate-space-count"]');
      select.value = '0'; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`
    )
    await inSettings(
      app,
      `document.querySelector('[data-setting="files-shortcut"]').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true }))`
    )
    await expect
      .poll(() =>
        inSettings(
          app,
          `document.querySelector('.search-source-settings [role="status"]').textContent`
        )
      )
      .toContain('唤起或关闭窗口')
    expect(
      await inSettings(app, `document.querySelector('[data-setting="files-shortcut"]').value`)
    ).toBe('')
    await inSettings(
      app,
      `document.querySelector('[data-setting="files-shortcut"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`
    )
    await expect
      .poll(() =>
        inSettings(
          app,
          `document.querySelector('.search-source-settings [role="status"]').textContent`
        )
      )
      .toContain('不能使用相同组合键')
    await inSettings(
      app,
      `document.querySelector('[data-setting="files-shortcut"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', altKey: true, bubbles: true, cancelable: true }))`
    )
    await expect
      .poll(() =>
        inSettings(app, `document.querySelector('[data-setting="files-shortcut"]').value`)
      )
      .toBe('Alt+F')
    await inSettings(
      app,
      `Array.from(document.querySelectorAll('.search-source-settings button')).find(item => item.textContent.includes('保存搜索范围')).click()`
    )
    const expectedQuick = {
      autoCalculate: true,
      autoTranslate: false,
      triggers: {
        translate: { spaceCount: 0, shortcut: 'Ctrl+Shift+T' },
        files: { spaceCount: 2, shortcut: 'Alt+F' }
      }
    }
    await expect
      .poll(() =>
        host.evaluate(async () => (await window.ztools.dbGet('settings-general')).quickSearch)
      )
      .toEqual(expectedQuick)
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))!
        .reload()
    )
    await expect
      .poll(
        () =>
          inSettings(
            app,
            `document.querySelector('[data-setting="translate-space-count"]')?.value`
          ),
        { timeout: 30_000 }
      )
      .toBe('0')
    expect(
      await inSettings(app, `document.querySelector('[data-setting="files-space-count"]').value`)
    ).toBe('2')
    expect(
      await inSettings(app, `document.querySelector('[data-setting="files-shortcut"]').value`)
    ).toBe('Alt+F')
    expect(
      await host.evaluate(async () => (await window.ztools.dbGet('settings-general')).quickSearch)
    ).toEqual(expectedQuick)

    expect(
      await app.evaluate(({ BrowserWindow }) => ({
        requests: (globalThis as any).__providerFetchCount,
        visible: BrowserWindow.getAllWindows().some((win) => win.isVisible()),
        focused: BrowserWindow.getFocusedWindow() !== null
      }))
    ).toEqual({ requests: 0, visible: false, focused: false })
  } finally {
    await app.close()
  }
})
