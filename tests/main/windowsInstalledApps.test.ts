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
      targetPath: utools.path.toUpperCase(),
      launchSignature: 'default'
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

describe('cross-source launch deduplication', () => {
  /**
   * Create an invented product candidate without touching an installed application.
   * @param product Fixture product label.
   * @param suffix Executable suffix.
   * @returns Synthetic metadata.
   */
  function candidate(product: string, suffix = ''): InstalledAppCandidate {
    return {
      path: `C:/Fixture/${product}/${product}${suffix}.exe`,
      label: product,
      productName: product,
      source: 'directory',
      subsystem: 2
    }
  }
  it.each(['Gemini', 'Nebula', 'Aurora'])(
    'merges %s alternate launchers into the verified primary shortcut',
    (product) => {
      const primary = candidate(product)
      const shortcut = {
        name: product,
        path: `C:/Start/${product}.lnk`,
        targetPath: primary.path,
        icon: 'official-icon'
      }
      const result = mergeInstalledApplications(
        [shortcut],
        [candidate(product, 'AppLauncher'), primary],
        [{ ...shortcut, launchSignature: 'default' }]
      )
      expect(result).toEqual([{ ...shortcut, launchSignature: 'default' }])
    }
  )
  it.each(['Launcher', 'AppLauncher', 'Launch'])(
    'prefers a primary over %s independently of source order',
    (suffix) => {
      const primary = candidate('Nebula')
      const alternate = candidate('Nebula', suffix)
      for (const entries of [
        [alternate, primary],
        [primary, alternate]
      ]) {
        expect(mergeInstalledApplications([], entries).map((item) => item.path)).toEqual([
          primary.path
        ])
      }
      expect(mergeInstalledApplications([], [alternate]).map((item) => item.path)).toEqual([
        alternate.path
      ])
    }
  )
  it('preserves different install directories and non-launcher tools in a product suite', () => {
    const entries = [
      candidate('Nebula'),
      { ...candidate('Nebula', 'Launcher'), path: 'D:/Other/NebulaLauncher.exe' },
      candidate('Nebula', 'Editor'),
      candidate('Nebula2', 'Launcher')
    ]
    expect(mergeInstalledApplications([], entries)).toHaveLength(4)
  })
  it('preserves unknown shortcuts, distinct profiles, and the default executable', () => {
    const primary = candidate('Nebula')
    const shortcuts = ['a', 'b', 'unknown'].map((id) => ({
      name: 'Nebula',
      path: `C:/Start/${id}.lnk`,
      targetPath: primary.path
    }))
    const metadata = shortcuts
      .slice(0, 2)
      .map((item, i) => ({ ...item, launchSignature: String(i).repeat(64) }))
    expect(mergeInstalledApplications(shortcuts, [primary], metadata)).toHaveLength(4)
  })
  it('merges equal verified shortcuts but does not attach metadata for a changed target', () => {
    const primary = candidate('Nebula')
    const shortcuts = ['a', 'b'].map((id) => ({
      name: 'Nebula',
      path: `C:/Start/${id}.lnk`,
      targetPath: primary.path
    }))
    const metadata = shortcuts.map((item) => ({ ...item, launchSignature: 'default' }))
    expect(mergeInstalledApplications(shortcuts, [primary], metadata)).toHaveLength(1)
    expect(
      mergeInstalledApplications(
        shortcuts,
        [primary],
        metadata.map((item) => ({ ...item, targetPath: 'C:/Changed.exe' }))
      )
    ).toHaveLength(3)
  })
  it('discards invalid metadata without treating an unavailable identity as default', () => {
    const value = parseInstalledDiscoveryResult({
      candidates: [],
      complete: true,
      shortcuts: [
        { path: 'a', targetPath: 'b', launchSignature: 'raw arguments' },
        { path: 'a', targetPath: 'b', launchSignature: 'default' }
      ]
    })
    expect(value.shortcuts).toEqual([{ path: 'a', targetPath: 'b', launchSignature: 'default' }])
  })
})
