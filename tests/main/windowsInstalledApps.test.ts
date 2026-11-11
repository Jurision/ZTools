import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {} }))
vi.mock('../../src/main/utils/common', () => ({ extractAcronym: (value: string) => value }))
import {
  parseInstalledDiscoveryResult,
  isInstalledGuiApplication,
  mergeInstalledApplications,
  type InstalledAppCandidate
} from '../../src/main/core/commandScanner/windowsInstalledApps'
const utools: InstalledAppCandidate = {
  path: 'C:/Users/mx-ui/AppData/Local/Programs/utools/uTools.exe',
  label: 'utools',
  source: 'directory',
  subsystem: 2,
  productName: 'uTools',
  description: 'uTools'
}
const localizedRegistered: InstalledAppCandidate = {
  path: 'D:/Apps/Netdisk/BaiduNetdisk.exe',
  label: '百度网盘',
  source: 'registered',
  subsystem: 2,
  productName: 'BaiduYunGuanjia Application',
  description: 'BaiduNetdisk',
  originalFilename: 'BaiduNetdisk.exe'
}
describe('installed GUI application fallback', () => {
  it('recognizes a registered localized app whose internal product name differs from its entry point', () => {
    expect(isInstalledGuiApplication(localizedRegistered)).toBe(true)
    expect(mergeInstalledApplications([], [localizedRegistered])).toMatchObject([
      { name: '百度网盘', path: localizedRegistered.path }
    ])
  })
  it('prefers the registered display name across duplicate directory and App Paths candidates', () => {
    const directory = {
      ...localizedRegistered,
      label: 'BaiduNetdisk',
      source: 'directory' as const
    }
    const appPath = {
      ...localizedRegistered,
      label: 'BaiduNetdisk.exe',
      source: 'app-path' as const
    }
    for (const candidates of [
      [directory, appPath, localizedRegistered],
      [localizedRegistered, directory, appPath]
    ]) {
      expect(mergeInstalledApplications([], candidates)).toMatchObject([{ name: '百度网盘' }])
      expect(mergeInstalledApplications([], candidates)).toHaveLength(1)
    }
  })
  it('requires exact executable-description identity for mismatched registered product names', () => {
    expect(isInstalledGuiApplication({ ...localizedRegistered, source: 'directory' })).toBe(false)
    expect(
      isInstalledGuiApplication({ ...localizedRegistered, description: 'BaiduNetdisk Companion' })
    ).toBe(false)
    expect(
      isInstalledGuiApplication({
        ...localizedRegistered,
        path: 'D:/Apps/Netdisk/BaiduNetdiskHost.exe'
      })
    ).toBe(false)
    expect(
      isInstalledGuiApplication({
        ...localizedRegistered,
        path: 'D:/Apps/Netdisk/BaiduNetdiskRender.exe'
      })
    ).toBe(false)
    expect(isInstalledGuiApplication({ ...localizedRegistered, description: '' })).toBe(false)
    expect(isInstalledGuiApplication({ ...localizedRegistered, subsystem: 3 })).toBe(false)
    expect(
      isInstalledGuiApplication({
        ...localizedRegistered,
        path: 'D:/Apps/Netdisk/uninstall.exe',
        description: 'uninstall'
      })
    ).toBe(false)
  })

  it('does not promote product-prefixed host/render helpers found beside the main program', () => {
    for (const suffix of ['Host', 'Render', 'Renderer', 'Helper']) {
      expect(
        isInstalledGuiApplication({
          ...localizedRegistered,
          source: 'directory',
          label: 'BaiduNetdisk',
          productName: 'BaiduNetdisk',
          path: `D:/Apps/Netdisk/BaiduNetdisk${suffix}.exe`,
          description: `BaiduNetdisk${suffix}`
        })
      ).toBe(false)
    }
    expect(
      isInstalledGuiApplication({
        ...localizedRegistered,
        path: 'D:/Apps/Netdisk/HelpUtility.exe',
        description: 'HelpUtility',
        source: 'directory'
      })
    ).toBe(false)
    // A genuine product name containing "host" is not globally blacklisted.
    expect(
      isInstalledGuiApplication({
        ...localizedRegistered,
        label: 'Ghost',
        productName: 'Ghost',
        path: 'D:/Apps/Ghost/Ghost.exe',
        description: 'Ghost',
        source: 'directory'
      })
    ).toBe(true)
  })
  it('discovers applications with no shortcuts and versioned folder labels', () => {
    expect(isInstalledGuiApplication(utools)).toBe(true)
    expect(isInstalledGuiApplication({ ...utools, label: 'uTools 7.7.0' })).toBe(true)
    expect(mergeInstalledApplications([], [utools])[0]).toMatchObject({
      name: 'uTools',
      path: utools.path
    })
  })
  it('allows registered app paths outside standard installation roots', () => {
    expect(
      isInstalledGuiApplication({
        ...utools,
        path: 'D:/Portable/MyTool/tool.exe',
        source: 'app-path',
        label: 'tool.exe',
        productName: 'My GUI Tool'
      })
    ).toBe(true)
  })
  it('preserves existing shortcuts and deduplicates registry entries by actual target', () => {
    const shortcut = {
      name: 'My uTools shortcut',
      path: 'C:/Start/uTools.lnk',
      targetPath: utools.path.toUpperCase()
    }
    expect(
      mergeInstalledApplications([shortcut], [utools, { ...utools, source: 'app-path' }])
    ).toEqual([shortcut])
    expect(
      mergeInstalledApplications([], [utools, { ...utools, source: 'registered' }])
    ).toHaveLength(1)
  })
  it('allows authoritative App Paths metadata after a directory candidate fails identity matching', () => {
    const candidate = {
      ...utools,
      path: 'C:/Apps/launcher.exe',
      label: 'Different Folder',
      productName: 'Friendly Product'
    }
    expect(isInstalledGuiApplication(candidate)).toBe(false)
    expect(
      mergeInstalledApplications([], [candidate, { ...candidate, source: 'app-path' }])
    ).toHaveLength(1)
  })

  it('excludes console programs, documents, system commands and support executables', () => {
    for (const filename of [
      'unins000.exe',
      'Update.exe',
      'helper.exe',
      'crashpad_handler.exe',
      'setup.exe',
      'services.exe',
      'manual.pdf',
      'globalflags.exe'
    ]) {
      expect(isInstalledGuiApplication({ ...utools, path: `C:/Apps/${filename}` })).toBe(false)
    }
    expect(isInstalledGuiApplication({ ...utools, subsystem: 3 })).toBe(false)
    expect(isInstalledGuiApplication({ ...utools, path: 'C:/Windows/System32/task.exe' })).toBe(
      false
    )
    expect(isInstalledGuiApplication({ ...utools, path: 'C:/Apps/unrelated.exe' })).toBe(false)
    expect(
      isInstalledGuiApplication({ ...utools, productName: 'Electron', source: 'app-path' })
    ).toBe(false)
  })
})

describe('discovery completeness', () => {
  it('distinguishes a complete empty scan from invalid, failed or budget-limited output', () => {
    expect(parseInstalledDiscoveryResult({ candidates: [], complete: true })).toEqual({
      candidates: [],
      complete: true
    })
    expect(parseInstalledDiscoveryResult([]).complete).toBe(false)
    expect(
      parseInstalledDiscoveryResult({ candidates: [utools], complete: false, error: 'budget' })
    ).toEqual({ candidates: [utools], complete: false, error: 'budget' })
    expect(parseInstalledDiscoveryResult({ candidates: [{}], complete: true }).complete).toBe(false)
  })
})
