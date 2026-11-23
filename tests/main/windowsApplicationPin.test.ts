import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execute, choose } = vi.hoisted(() => ({ execute: vi.fn(), choose: vi.fn() }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: execute })
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => 'C:/fixture' },
  dialog: { showMessageBox: choose }
}))
import { pinWindowsApplication } from '../../src/main/core/windowsApplicationPin'

describe.runIf(process.platform === 'win32')('Windows application pin result', () => {
  const item = "C:\\Apps\\Example's app.lnk"
  const owner = {} as BrowserWindow
  beforeEach(() => {
    execute.mockReset()
    choose.mockReset()
  })
  it.each(['start', 'taskbar'])(
    'hands off an interactive %s pin only after the user chooses Explorer',
    async (dest) => {
      execute
        .mockResolvedValueOnce({ stdout: 'interactive' })
        .mockResolvedValueOnce({ stdout: 'revealed' })
      choose.mockResolvedValueOnce({ response: 0 })
      expect(await pinWindowsApplication(item, dest, owner)).toContain('右键选择')
      expect(choose).toHaveBeenCalledOnce()
      expect(execute.mock.calls[1][1]).toEqual(
        expect.arrayContaining(['-Destination', dest, '-Reveal'])
      )
      expect(execute.mock.calls[1][2].env.ZTOOLS_PIN_ITEM).toBe(item)
    }
  )
  it('leaves the desktop alone if handoff is cancelled', async () => {
    execute.mockResolvedValueOnce({ stdout: 'interactive' })
    choose.mockResolvedValueOnce({ response: 1 })
    expect(await pinWindowsApplication(item, 'start', owner)).toBe('已取消')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('reports success only for the confirmed helper result', async () => {
    execute.mockResolvedValueOnce({ stdout: 'pinned' })
    expect(await pinWindowsApplication(item, 'taskbar', owner)).toBe('已固定到任务栏')
    expect(choose).not.toHaveBeenCalled()
  })
})
