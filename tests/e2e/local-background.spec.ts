import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { open } from 'lmdb'
import { calculateQuickExpression } from '../../src/shared/quickCalculation'
const projectRoot = path.resolve(__dirname, '../..')
const pluginRoot = path.join(projectRoot, '.local-work/plugins')
/**
 * Run DOM operations only in an isolated hidden plugin view.
 * @param app Source Electron instance.
 * @param name Fixture plugin name.
 * @param script Renderer operation.
 * @returns Renderer result.
 */
async function inPlugin(app: ElectronApplication, name: string, script: string): Promise<any> {
  return app.evaluate(
    async ({ webContents }, input) => {
      const view = webContents
        .getAllWebContents()
        .find((item) => item.getURL().includes(input.name + '/index.html'))
      return view ? view.executeJavaScript(input.script) : null
    },
    { name, script }
  )
}
/**
 * Exercise original React textarea input without desktop input.
 * @param app Isolated source instance.
 * @param name Fixture plugin name.
 * @param expression Formula to enter.
 * @returns Completes after event dispatch.
 */
async function enterFormula(
  app: ElectronApplication,
  name: string,
  expression: string
): Promise<void> {
  await inPlugin(
    app,
    name,
    `(()=>{const input=document.querySelector('.calc textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(expression)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`
  )
}
// eslint-disable-next-line no-empty-pattern -- Source Electron needs testInfo but no browser fixtures.
test('original calculator behavior is preserved with chronological saving in a hidden host', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const names = ['calculation-paper-baseline', 'calculation-paper-next']
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-history-acceptance-'))
  const legacyRoot = path.join(dataRoot, 'legacy'),
    devicePath = path.join(dataRoot, 'lmdb/device')
  fs.mkdirSync(legacyRoot, { recursive: true })
  fs.mkdirSync(devicePath, { recursive: true })
  const env = open({ path: devicePath, maxDbs: 6, encoding: 'binary', compression: false })
  const db = env.openDB<string>({ name: 'main', encoding: 'string' })
  const plugins = names.map((name) => ({
    ...JSON.parse(fs.readFileSync(path.join(pluginRoot, name, 'plugin.json'), 'utf8')),
    path: path.join(pluginRoot, name),
    isDevelopment: false,
    storageKind: 'directory'
  }))
  db.putSync(
    'ZTOOLS/plugins',
    JSON.stringify({ _id: 'ZTOOLS/plugins', _rev: '1-test', data: plugins })
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
    await host.locator('.search-input').fill('计算稿纸')
    await expect(host.locator('.app-item, .list-item').filter({ hasText: '计算稿纸' })).toHaveCount(
      0
    )
    await host.locator('.search-input').fill('> 计算稿纸')
    await expect(
      host.locator('.app-item, .list-item').filter({ hasText: '计算稿纸' }).first()
    ).toBeVisible({ timeout: 30_000 })
    const expressions = ['200000*1.5', '4/34', '30*1.15', '0.1+0.2', '(3+4)×2', '100÷8'],
      baseline: string[] = []
    for (const name of names) {
      await host.evaluate(
        async (target) =>
          (window as any).ztools.launch({
            path: target,
            type: 'plugin',
            featureCode: 'calc',
            name: '计算稿纸'
          }),
        path.join(pluginRoot, name)
      )
      await expect
        .poll(() => inPlugin(app!, name, 'document.querySelectorAll(".calc textarea").length'))
        .toBeGreaterThan(0)
      for (const [index, expression] of expressions.entries()) {
        const quick = calculateQuickExpression(expression)
        expect(quick).not.toBeNull()
        // Feed supported ASCII operators to the untouched original editor, then compare its output.
        const normalized = expression.replace(/×/g, '*').replace(/÷/g, '/')
        expect(quick!.expression).toBe(normalized)
        await enterFormula(app, name, normalized)
        await expect
          .poll(() => inPlugin(app!, name, 'document.querySelector(".calc textarea").value'))
          .toBe(normalized)
        await expect
          .poll(() =>
            inPlugin(app!, name, 'document.querySelector(".calc .result")?.textContent.trim()')
          )
          .toBe(quick!.result)
        const result = await inPlugin(
          app,
          name,
          'document.querySelector(".calc .result").textContent.trim()'
        )
        if (name === names[0]) baseline.push(result)
        else expect(result).toBe(baseline[index])
        expect(quick!.copyText).toBe(result.replace(/,/g, ''))
      }
    }
    expect(baseline).toEqual([
      '300,000',
      '0.11764705882352941176470588235294',
      '34.5',
      '0.3',
      '14',
      '12.5'
    ])
    const name = names[1]
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelector("#history-status").textContent'))
      .toContain('已自动保存')
    const firstId = await inPlugin(app, name, 'window.PaperHistory.active.store.currentId')
    await inPlugin(app, name, 'document.querySelector("#history-new").click()')
    await enterFormula(app, name, '100/4')
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelector("#history-status").textContent'))
      .toContain('已自动保存')
    await inPlugin(app, name, `window.PaperHistory.active.navigate(${JSON.stringify(firstId)})`)
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelector(".calc textarea").value'))
      .toBe('100/8')
    await enterFormula(app, name, '128*3+61')
    await inPlugin(app, name, 'window.dispatchEvent(new Event("blur")); true')
    const records = await inPlugin(app, name, 'window.ztools.db.allDocs("paper/")')
    expect(records).toHaveLength(2)
    expect(records.find((doc: any) => doc._id === firstId).calcList[0].expression).toBe('128*3+61')
    await inPlugin(app, name, 'location.reload(); true')
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelectorAll(".history-item").length'))
      .toBe(3)
    await inPlugin(app, name, `window.PaperHistory.active.navigate(${JSON.stringify(firstId)})`)
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelector(".calc .result")?.textContent'))
      .toContain('445')
    await inPlugin(
      app,
      name,
      'window.PaperHistory.active.app.handleRefreshPaper([{expression:"200000*1.5"},{expression:"4/34"},{expression:"30*1.15"}]); true'
    )
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelectorAll(".calc .result").length'))
      .toBeGreaterThanOrEqual(3)
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelector("#history-status").textContent'))
      .toContain('已自动保存')
    const png = await app.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((item) => item.getURL().includes('calculation-paper-next/index.html'))!
      return (await view.capturePage()).toPNG().toString('base64')
    })
    fs.writeFileSync(testInfo.outputPath('original-paper-history.png'), Buffer.from(png, 'base64'))
    // Search uses actual host inputs and IPC, never a direct call to the filtering method.
    await inPlugin(
      app,
      name,
      `window.PaperHistory.active.rename(${JSON.stringify(firstId)}, '测试 USD'); window.PaperHistory.active.app.handleRefreshPaper([{expression:'200000*1.5',remark:'报价备注'}]); true`
    )
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelector("#history-status").textContent'))
      .toContain('已自动保存')
    const persistedBeforeSearch = await inPlugin(app, name, 'window.ztools.db.allDocs("paper/")')
    await host.locator('.search-input').fill('测试')
    await expect
      .poll(() =>
        inPlugin(
          app!,
          name,
          'Array.from(document.querySelectorAll(".history-item")).map(item=>item.dataset.id)'
        )
      )
      .toEqual([firstId])
    await host.locator('.search-input').fill('')
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelectorAll(".history-item").length'))
      .toBe(3)
    // Background mode intentionally rejects detached windows; test the real main-host bridge.
    for (const text of ['测试', 'usd', '200000*1.5', '报价备注']) {
      await host.locator('.search-input').fill(text)
      await expect
        .poll(() =>
          inPlugin(
            app!,
            name,
            'Array.from(document.querySelectorAll(".history-item")).map(item=>item.dataset.id)'
          )
        )
        .toEqual([firstId])
    }
    const creationDate = await inPlugin(
      app,
      name,
      `new Date(window.PaperHistory.active.store.current().createAt).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})`
    )
    await host.locator('.search-input').fill(creationDate)
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelectorAll(".history-item").length'))
      .toBe(3)
    await host.locator('.search-input').fill('不存在的测试稿纸')
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelector("#history-empty")?.textContent'))
      .toBe('没有匹配的稿纸，清空搜索可查看全部')
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelectorAll(".history-item").length'))
      .toBe(0)
    expect(await inPlugin(app, name, 'window.PaperHistory.active.store.currentId')).toBe(firstId)
    expect(await inPlugin(app, name, 'document.querySelector(".calc textarea").value')).toBe(
      '200000*1.5'
    )
    await host.locator('.search-input').fill('')
    await expect
      .poll(() => inPlugin(app!, name, 'document.querySelectorAll(".history-item").length'))
      .toBe(3)
    expect(await inPlugin(app, name, 'window.ztools.db.allDocs("paper/")')).toEqual(
      persistedBeforeSearch
    )
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((win) => win.isVisible())
      )
    ).toBe(false)
  } finally {
    await app?.close()
  }
})
