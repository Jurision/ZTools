import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * Create or reposition the actual panel through the background-only main-process test entry.
 * @param application Isolated source Electron instance.
 * @param edge Whether to summon at the work area's lower right corner.
 * @returns Work area and requested summon point for assertions.
 */
async function preparePanel(application: ElectronApplication, edge = false) {
  return application.evaluate(({ ipcMain, screen }, atEdge) => {
    const workArea = screen.getPrimaryDisplay().workArea
    const point = atEdge
      ? { x: workArea.x + workArea.width - 1, y: workArea.y + workArea.height - 1 }
      : { x: workArea.x + 10, y: workArea.y + 10 }
    ipcMain.emit('super-panel:test-prepare', null, point)
    return { workArea, point }
  }, edge)
}

test('panel saves only size, follows each summon point and stays hidden in background tests', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-panel-layout-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  await fs.mkdir(legacyRoot)
  const launchOptions = {
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      ZTOOLS_E2E: '1',
      ZTOOLS_BACKGROUND_TEST: '1',
      ZTOOLS_DATA_ROOT: dataRoot,
      ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot
    }
  }
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch(launchOptions)
    let host = await application.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    await preparePanel(application)
    await expect.poll(async () => (await application!.windows()).length).toBe(2)
    const panel = (await application.windows()).find((page) => page !== host)!
    await expect(panel.locator('.super-panel')).toBeAttached()
    // Normal summon sends pinned/search data after preparing the window. Exercise
    // the real pinned-data IPC without triggering clipboard capture or mouse hooks.
    await panel.evaluate(() => (window as any).ztools.superPanelShowPinned())
    await expect(panel.locator('.search-header')).toBeAttached()
    expect(
      await panel
        .locator('.header-text')
        .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'))
    ).toBe('drag')
    expect(
      await panel
        .locator('.header-actions')
        .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'))
    ).toBe('no-drag')

    // Emulate the native event rather than relying on setBounds, which intentionally does not save.
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('super-panel.html')
      )!
      const bounds = { ...win.getBounds(), width: 360, height: 480 }
      win.emit('will-resize', { preventDefault() {} }, bounds, { edge: 'bottom-right' })
      win.setBounds(bounds)
      win.emit('blur')
    })
    await expect
      .poll(() => host.evaluate(() => (window as any).ztools.dbGet('super-panel-window-size')))
      .toEqual({ width: 360, height: 480 })
    const { workArea } = await preparePanel(application, true)
    const state = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('super-panel.html')
      )!
      return {
        bounds: win.getBounds(),
        resizable: win.isResizable(),
        visible: BrowserWindow.getAllWindows().some((item) => item.isVisible()),
        focused: BrowserWindow.getFocusedWindow() !== null
      }
    })
    expect(state).toEqual({
      bounds: {
        x: workArea.x + workArea.width - Math.min(360, workArea.width),
        y: workArea.y + workArea.height - Math.min(480, workArea.height),
        width: Math.min(360, workArea.width),
        height: Math.min(480, workArea.height)
      },
      resizable: true,
      visible: false,
      focused: false
    })
    await panel.screenshot({ path: testInfo.outputPath('super-panel-resized.png') })
    await application.close()
    application = await electron.launch(launchOptions)
    host = await application.firstWindow()
    await expect(host.locator('.search-input')).toBeAttached()
    expect(
      await host.evaluate(() => (window as any).ztools.dbGet('super-panel-window-size'))
    ).toEqual({ width: 360, height: 480 })
    const { point } = await preparePanel(application)
    await expect
      .poll(async () =>
        application!.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find((item) =>
            item.webContents.getURL().includes('super-panel.html')
          )
          return win
            ? { x: win.getBounds().x, y: win.getBounds().y, visible: win.isVisible() }
            : null
        })
      )
      .toEqual({ x: point.x, y: point.y, visible: false })
  } finally {
    await application?.close()
  }
})
