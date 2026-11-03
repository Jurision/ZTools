import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { open } from 'lmdb'

const projectRoot = path.resolve(__dirname, '../..')
const pluginPath = path.join(projectRoot, 'local-plugins/calculation-paper-next')
const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginPath, 'plugin.json'), 'utf8'))

/**
 * Execute test-only DOM interaction inside the hidden plugin view, never a desktop window.
 * @param application Isolated source Electron process.
 * @param script DOM test operation.
 * @returns The structured value returned by the plugin renderer.
 */
async function inPaper(application: ElectronApplication, script: string): Promise<any> {
  return application.evaluate(async ({ webContents }, source) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('calculation-paper-next/index.html'))
    if (!contents) return null
    return contents.executeJavaScript(source)
  }, script)
}

test('application-only search and multi-paper persistence work in a hidden isolated host', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-local-acceptance-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const devicePath = path.join(dataRoot, 'lmdb/device')
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
        { ...pluginManifest, path: pluginPath, isDevelopment: false, storageKind: 'directory' }
      ]
    })
  )
  env.close()
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
    const host = await application.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    await host.locator('.search-input').fill('计算稿纸时间记录')
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: '计算稿纸时间记录' })
    ).toHaveCount(0)
    await host.locator('.search-input').fill('> 计算稿纸时间记录')
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: '计算稿纸时间记录' }).first()
    ).toBeVisible({ timeout: 30_000 })
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.isVisible())
      )
    ).toBe(false)

    // Launch through the actual host API; fixtures only affect the isolated registry.
    await host.evaluate(
      async (target) =>
        (window as any).ztools.launch({
          path: target,
          type: 'plugin',
          featureCode: 'paper',
          name: '计算稿纸时间记录'
        }),
      pluginPath
    )
    await expect
      .poll(() => inPaper(application!, 'document.querySelector("#save-state")?.textContent'))
      .toContain('开始输入')
    await inPaper(
      application,
      `(() => {const e=document.querySelector('.expression');e.value='128*3+60';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`
    )
    await expect
      .poll(() => inPaper(application!, 'document.querySelector(".result")?.textContent'))
      .toBe('= 444')
    await expect
      .poll(() => inPaper(application!, 'document.querySelector("#save-state")?.textContent'))
      .toContain('已自动保存')
    const firstId = await inPaper(
      application,
      'document.querySelector(".paper-item[aria-current=true]").dataset.id'
    )
    await inPaper(application, 'document.querySelector("#new-paper").click()')
    await inPaper(
      application,
      `(() => {const e=document.querySelector('.expression');e.value='100/4';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`
    )
    await expect
      .poll(() => inPaper(application!, 'document.querySelector("#save-state")?.textContent'))
      .toContain('已自动保存')
    await inPaper(
      application,
      `document.querySelector('[data-id=${JSON.stringify(firstId)}]').click()`
    )
    await expect
      .poll(() => inPaper(application!, 'document.querySelector(".expression").value'))
      .toBe('128*3+60')
    await inPaper(
      application,
      `(() => {const e=document.querySelector('.expression');e.value='128*3+61';e.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new Event('blur'));return true})()`
    )
    const docs = await inPaper(application, 'window.ztools.db.allDocs("paper/")')
    expect(docs).toHaveLength(2)
    expect(docs.find((doc: any) => doc._id === firstId)?.calcList[0].expression).toBe('128*3+61')
    await inPaper(application, 'location.reload(); true')
    await expect
      .poll(() => inPaper(application!, 'document.querySelectorAll(".paper-item").length'))
      .toBe(3)
    await inPaper(
      application,
      `document.querySelector('[data-id=${JSON.stringify(firstId)}]').click()`
    )
    expect(await inPaper(application, 'document.querySelector(".expression").value')).toBe(
      '128*3+61'
    )
    expect(await inPaper(application, 'document.querySelector(".result").textContent')).toBe(
      '= 445'
    )
    const png = await application.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('calculation-paper-next/index.html'))!
      return (await view.capturePage()).toPNG().toString('base64')
    })
    fs.writeFileSync(testInfo.outputPath('calculation-paper.png'), Buffer.from(png, 'base64'))
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.isVisible())
      )
    ).toBe(false)
  } finally {
    await application?.close()
  }
})
