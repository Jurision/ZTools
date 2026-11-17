import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { open } from 'lmdb'
import AdmZip from 'adm-zip'

const projectRoot = path.resolve(__dirname, '../..')
test.use({ screenshot: 'off', trace: 'off' })

/**
 * Write fake startup data to an isolated profile.
 * @param root Temporary profile directory.
 * @param scope Database scope.
 * @param key Document key.
 * @param data Fake record value.
 * @returns No return value.
 */
function seed(root: string, scope: string, key: string, data: unknown): void {
  const folder = path.join(root, 'lmdb', scope)
  fs.mkdirSync(folder, { recursive: true })
  const env = open({ path: folder, maxDbs: 6, encoding: 'binary', compression: false })
  const db = env.openDB<string>({ name: 'main', encoding: 'string' })
  db.putSync(key, JSON.stringify({ _id: key, _rev: '1-test', data }))
  env.close()
}

test('avatar explicitly opens AI, preserves empty settings and streams a fake provider reply', async () => {
  test.setTimeout(120_000)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-avatar-ai-'))
  const pluginRoot = path.join(root, 'plugins', 'ai-helper')
  fs.mkdirSync(pluginRoot, { recursive: true })
  fs.mkdirSync(path.join(root, 'legacy'))
  const zip = process.env.ZTOOLS_TEST_AI_HELPER_ZIP
  if (zip) {
    new AdmZip(zip).extractAllTo(pluginRoot)
  } else {
    fs.writeFileSync(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({
        name: 'ai-helper',
        title: 'AI助手',
        version: '1.0.0',
        main: 'index.html',
        features: [{ code: 'chat', cmds: [{ type: 'over', label: 'AI对话' }] }]
      })
    )
    fs.writeFileSync(
      path.join(pluginRoot, 'index.html'),
      `<!doctype html><body><main></main><script>
      window.ztools.onPluginEnter(async ({ type, payload }) => {
        if (type !== 'over') return;
        document.querySelector('main').textContent = payload;
        try { await window.ztools.ai({messages:[{role:'user',content:payload}]}, chunk => {
          document.querySelector('main').textContent += chunk.content || '';
        }); } catch { document.querySelector('main').textContent += '失败'; }
      });
    </script></body>`
    )
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  seed(root, 'device', 'ZTOOLS/plugins', [
    { ...manifest, path: pluginRoot, storageKind: 'directory', isDevelopment: false }
  ])
  const requests: any[] = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ url: req.url, body: JSON.parse(body) })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      'data: ' +
        JSON.stringify({
          id: 'fake',
          choices: [{ index: 0, delta: { content: '隔离测试回答' }, finish_reason: null }]
        }) +
        '\n\ndata: [DONE]\n\n'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  seed(root, 'accounts/default', 'ZTOOLS/ai-models', {
    version: 2,
    providers: [
      {
        id: 'fake-deepseek',
        name: 'DeepSeek test',
        enabled: true,
        apiFormat: 'openai-chat',
        apiUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'fake-local-test-key',
        selectedModels: [{ ref: 'fake-flash', modelId: 'deepseek-flash' }]
      }
    ]
  })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
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
        ZTOOLS_DATA_ROOT: root,
        ZTOOLS_LEGACY_USER_DATA_PATH: path.join(root, 'legacy'),
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const host = await app.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    await app.evaluate(({ ipcMain }) => {
      ;(globalThis as any).__avatarSettingsCount = 0
      ipcMain.removeAllListeners('open-settings')
      ipcMain.on('open-settings', () => {
        ;(globalThis as any).__avatarSettingsCount++
      })
    })
    await host.locator('.avatar-wrapper').dispatchEvent('click')
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__avatarSettingsCount)).toBe(1)
    await host.locator('.search-input').fill('你好，帮我安排今天的工作')
    await host.waitForTimeout(650)
    expect(requests).toHaveLength(0)
    // Composition cannot accidentally submit an unfinished syllable.
    await host.locator('.search-input').dispatchEvent('compositionstart')
    await host.locator('.avatar-wrapper').dispatchEvent('click')
    expect(requests).toHaveLength(0)
    await host.locator('.search-input').dispatchEvent('compositionend')
    await host.locator('.avatar-wrapper').dispatchEvent('click')
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].url).toBe('/chat/completions')
    expect(requests[0].body.model).toBe('deepseek-flash')
    expect(requests[0].body.messages.at(-1).content).toBe('你好，帮我安排今天的工作')
    await expect
      .poll(() =>
        app!.evaluate(async ({ webContents }) => {
          const view = webContents
            .getAllWebContents()
            .find((w) => w.getURL().includes('/ai-helper/index.html'))
          return view?.executeJavaScript('document.body.innerText')
        })
      )
      .toContain('隔离测试回答')
    // Return through the existing host lifecycle without touching the desktop.
    await host.evaluate(() => (window as any).ztools.hidePlugin())
    await host.locator('.search-input').fill('   ')
    await host.locator('.avatar-wrapper').dispatchEvent('click')
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__avatarSettingsCount)).toBe(2)
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('launch')
      ;(globalThis as any).__avatarLaunchCount = 0
      ipcMain.handle('launch', async () => {
        ;(globalThis as any).__avatarLaunchCount++
        await new Promise((resolve) => setTimeout(resolve, 250))
        return { success: false }
      })
    })
    await host.locator('.search-input').fill('失败时保留这段话')
    await host.evaluate(() => {
      const avatar = document.querySelector('.avatar-wrapper') as HTMLElement
      avatar.click()
      avatar.click()
    })
    await expect(host.locator('.avatar-ai-error')).toContainText('未能打开')
    await expect(host.locator('.search-input')).toHaveValue('失败时保留这段话')
    expect(await app.evaluate(() => (globalThis as any).__avatarLaunchCount)).toBe(1)
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('get-all-plugins')
      ipcMain.handle('get-all-plugins', () => [])
    })
    await host.locator('.avatar-wrapper').dispatchEvent('click')
    await expect(host.locator('.avatar-ai-error')).toContainText('安装并启用')
    expect(requests).toHaveLength(1)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !w.isVisible())
      )
    ).toBe(true)
  } finally {
    if (app) await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
