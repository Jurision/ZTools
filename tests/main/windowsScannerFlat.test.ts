import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeScanMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/core/native/index', () => ({
  WindowsShortcutScanner: { scan: nativeScanMock }
}))

vi.mock('../../src/main/utils/systemPaths', () => ({
  getWindowsRecursiveScanPaths: () => ['C:\\RecursiveOne', 'C:\\RecursiveTwo'],
  getWindowsFlatScanPaths: () => ['C:\\FlatOne', 'C:\\Desktop']
}))

vi.mock('../../src/main/utils/common', () => ({
  extractAcronym: vi.fn((name: string) => {
    if (name === 'BadApp') throw new Error('bad acronym')
    return name.slice(0, 2).toUpperCase()
  })
}))

import { scanApplications } from '../../src/main/core/commandScanner/windowsScanner'

describe('Windows 来源隔离扫描', () => {
  beforeEach(() => {
    nativeScanMock.mockReset()
  })

  it('递归目录和扁平目录分别使用独立 runner', async () => {
    nativeScanMock.mockResolvedValue([])

    const result = await scanApplications()

    expect(nativeScanMock).toHaveBeenCalledTimes(4)
    expect(nativeScanMock).toHaveBeenCalledWith(['C:\\RecursiveOne'], [], expect.any(Array))
    expect(nativeScanMock).toHaveBeenCalledWith([], ['C:\\Desktop'], expect.any(Array))
    expect(result).toEqual({ apps: [], complete: true, errors: [] })
  })

  it('单个来源超时只丢弃该来源并标记扫描不完整', async () => {
    nativeScanMock.mockImplementation(async (recursivePaths: string[], flatPaths: string[]) => {
      const sourcePath = recursivePaths[0] || flatPaths[0]
      if (sourcePath === 'C:\\Desktop') throw new Error('scan timed out')
      return [
        {
          name: sourcePath,
          path: `${sourcePath}\\App.lnk`,
          icon: `${sourcePath}\\App.lnk`,
          targetPath: `${sourcePath}\\App.exe`,
          sourceType: 'lnk'
        }
      ]
    })

    const result = await scanApplications()

    expect(result.complete).toBe(false)
    expect(result.apps).toHaveLength(3)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('flat:C:\\Desktop')
  })

  it('单条业务字段转换异常只跳过当前应用', async () => {
    nativeScanMock.mockResolvedValue([
      { name: 'BadApp', path: 'C:\\BadApp.lnk', icon: 'C:\\BadApp.lnk', sourceType: 'lnk' },
      {
        name: 'GoodApp',
        path: 'C:\\GoodApp.lnk',
        icon: 'C:\\GoodApp.lnk',
        sourceType: 'lnk'
      }
    ])

    const result = await scanApplications()

    expect(result.complete).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0].name).toBe('GoodApp')
  })
})

describe('原生扫描结果的搜索来源', () => {
  it('保留文件目标和应用协议，文件快捷方式不混入默认应用结果', async () => {
    nativeScanMock.mockResolvedValue([
      { name: '计算记录', path: 'C:/Notes.lnk', targetPath: 'C:/Notes.txt', sourceType: 'lnk' },
      { name: 'Editor', path: 'C:/Editor.lnk', targetPath: 'C:/Editor.exe', sourceType: 'lnk' },
      { name: 'Game', path: 'steam://rungameid/12345', sourceType: 'url', icon: 'C:/steam.ico' }
    ])
    const result = await scanApplications()
    expect(result.apps).toHaveLength(3)
    expect(result.apps.find((item) => item.name === '计算记录')).toMatchObject({
      targetPath: 'C:/Notes.txt',
      searchSource: 'files'
    })
    expect(result.apps.find((item) => item.name === 'Editor')?.searchSource).toBeUndefined()
    expect(result.apps.find((item) => item.name === 'Game')).toMatchObject({
      path: 'steam://rungameid/12345',
      icon: `ztools-icon://${encodeURIComponent('C:/steam.ico')}`
    })
    expect(result.apps.every((item) => !('_dedupeTarget' in item))).toBe(true)
  })
})
