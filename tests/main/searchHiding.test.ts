import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isHiddenSearchPath, normalizeHiddenPaths } from '../../src/shared/searchHiddenPaths'
import { isSearchCommandVisible, normalizeSearchSources } from '../../src/shared/searchSources'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, any>(),
  data: {} as any,
  put: vi.fn(),
  send: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, callback: any) => mocks.handlers.set(name, callback) }
}))
vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: () => mocks.data,
    dbPut: (_key: string, value: unknown) => {
      mocks.put(value)
      mocks.data = value
    }
  }
}))
import { registerSearchHiding } from '../../src/main/api/renderer/searchHiding'

beforeEach(() => {
  mocks.data = { hotkey: 'Ctrl+Space', fileSearch: { enabled: true, excludes: ['private'] } }
  mocks.put.mockReset()
  mocks.send.mockReset()
  registerSearchHiding({ webContents: { id: 7, send: mocks.send } } as never)
})

/**
 * Invoke the registered handler as the trusted fixture renderer.
 * @param kind Result kind.
 * @param paths Exact paths to hide.
 * @returns Handler result.
 */
function hide(kind: string, paths: unknown): unknown {
  return mocks.handlers.get('search:hide-result')({ sender: { id: 7 } }, kind, paths)
}

describe('persistent search hiding', () => {
  it('normalizes exact paths without substring matching or merging same-name files', () => {
    const hidden = normalizeHiddenPaths([
      ' D:\\Data\\Note.txt ',
      'd:/data/note.txt',
      null,
      '',
      'bad\npath'
    ])
    expect(hidden).toHaveLength(1)
    expect(isHiddenSearchPath('D:\\DATA\\NOTE.TXT', hidden)).toBe(true)
    expect(isHiddenSearchPath('D:\\Data\\Note.txt.bak', hidden)).toBe(false)
    expect(isHiddenSearchPath('E:\\Data\\Note.txt', hidden)).toBe(false)
    expect(isHiddenSearchPath('D:\\Data\\Note.txt\\child', hidden)).toBe(false)
  })
  it('hides app aliases and shortcuts to the same target, including explicit search', () => {
    hide('app', ['C:\\Start\\Telegram.lnk', 'D:\\Telegram.exe'])
    const prefs = normalizeSearchSources(mocks.data.searchSources)
    for (const name of ['Telegram', '电报']) {
      expect(
        isSearchCommandVisible(
          { type: 'direct', name, path: 'C:\\Other.lnk', targetPath: 'd:/Telegram.exe' },
          prefs
        )
      ).toBe(false)
      expect(
        isSearchCommandVisible(
          { type: 'direct', name, path: 'C:\\Start\\Telegram.lnk' },
          prefs,
          true
        )
      ).toBe(false)
    }
    expect(
      isSearchCommandVisible({ type: 'direct', name: 'Telegram', path: 'E:\\Different.exe' }, prefs)
    ).toBe(true)
    expect(mocks.data.hotkey).toBe('Ctrl+Space')
    expect(mocks.send).toHaveBeenCalledWith('update-search-sources', prefs)
  })
  it('merges consecutive hides without clearing app/file preferences or duplicate paths', () => {
    hide('file', ['D:\\one.txt'])
    hide('app', ['D:\\Telegram.exe'])
    hide('file', ['D:/ONE.txt'])
    hide('file', ['D:\\two.txt'])
    expect(mocks.data.fileSearch.hiddenPaths).toHaveLength(2)
    expect(mocks.data.fileSearch.excludes).toEqual(['private'])
    expect(mocks.data.searchSources.hiddenApplicationPaths).toEqual(['D:\\Telegram.exe'])
    expect(mocks.send).toHaveBeenLastCalledWith(
      'update-file-search-settings',
      mocks.data.fileSearch
    )
  })
  it('does not notify the UI when saving fails', () => {
    mocks.put.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => hide('file', ['D:\\one.txt'])).toThrow('disk full')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.data.fileSearch.hiddenPaths).toBeUndefined()
  })
  it('rejects untrusted senders and invalid requests', () => {
    expect(() =>
      mocks.handlers.get('search:hide-result')({ sender: { id: 99 } }, 'file', ['D:\\one.txt'])
    ).toThrow('Invalid search sender')
    for (const paths of [null, [], [42], ['a', 'b', 'c']])
      expect(() => hide('file', paths)).toThrow()
    expect(() => hide('delete', ['D:\\one.txt'])).toThrow()
    expect(mocks.put).not.toHaveBeenCalled()
  })
  it('restores an app when its exact exclusion is removed', () => {
    hide('app', ['D:\\Telegram.exe'])
    const prefs = normalizeSearchSources({
      ...mocks.data.searchSources,
      hiddenApplicationPaths: []
    })
    expect(
      isSearchCommandVisible({ type: 'direct', name: 'Telegram', path: 'D:\\Telegram.exe' }, prefs)
    ).toBe(true)
  })
})
