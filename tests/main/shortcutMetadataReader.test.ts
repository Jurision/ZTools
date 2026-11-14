import { describe, expect, it, vi } from 'vitest'
import { collectShortcutMetadata } from '../../src/main/core/commandScanner/shortcutMetadataReader'

describe('resumable shortcut metadata inventory', () => {
  it('processes a large inventory in bounded pages without losing new installations', async () => {
    const entries = Array.from({ length: 420 }, (_, index) => ({
      name: `App ${index}`,
      path: `C:/Fixture/${index}.lnk`
    }))
    const read = vi.fn(async (page: typeof entries) => ({
      complete: true,
      processed: page.length,
      shortcuts: page.map((x) => ({
        path: x.path,
        targetPath: x.path + '.exe',
        launchSignature: 'default'
      }))
    }))
    const result = await collectShortcutMetadata(entries, read)
    expect(result.complete).toBe(true)
    expect(result.shortcuts.map((x) => x.path)).toEqual(entries.map((x) => x.path))
    expect(read.mock.calls.every(([page]) => page.length <= 64)).toBe(true)
  })
  it('resumes after a time budget including unsupported shortcuts that produced no metadata', async () => {
    const entries = ['old', 'unsupported', 'new1', 'new2'].map((name) => ({
      name,
      path: `C:/Fixture/${name}.lnk`
    }))
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        complete: false,
        processed: 2,
        shortcuts: [{ path: entries[0].path, targetPath: 'C:/One.exe', launchSignature: 'default' }]
      })
      .mockResolvedValueOnce({
        complete: true,
        processed: 2,
        shortcuts: entries
          .slice(2)
          .map((x) => ({ path: x.path, targetPath: x.path + '.exe', launchSignature: 'default' }))
      })
    const result = await collectShortcutMetadata(entries, read)
    expect(read.mock.calls[1][0]).toEqual(entries.slice(2))
    expect(result.complete).toBe(true)
    expect(result.shortcuts).toHaveLength(3)
  })
  it('refuses stalled/invalid cursors and honors an overall deadline', async () => {
    const entries = [{ name: 'App', path: 'C:/Fixture/App.lnk' }]
    for (const processed of [0, -1, 2, 0.5, undefined]) {
      expect(
        (await collectShortcutMetadata(entries, async () => ({ complete: false, processed })))
          .complete
      ).toBe(false)
    }
    const read = vi.fn()
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(60001)
    expect((await collectShortcutMetadata(entries, read, now)).complete).toBe(false)
    expect(read).not.toHaveBeenCalled()
  })
  it('propagates helper failure for retry instead of reporting an empty successful inventory', async () => {
    await expect(
      collectShortcutMetadata([{ name: 'App', path: 'C:/Fixture/App.lnk' }], async () => {
        throw Error('fixture timeout')
      })
    ).rejects.toThrow('fixture timeout')
  })
})
