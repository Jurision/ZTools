import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {} }))
vi.mock('../../src/main/utils/common', () => ({ extractAcronym: (value: string) => value }))
import { installationIdentity } from '../../src/shared/applicationInstallation'
import {
  mergeInstalledApplications,
  isInstalledGuiApplication
} from '../../src/main/core/commandScanner/windowsInstalledApps'

const registration = {
  id: 'HKCU/Uninstall/Nebula',
  root: 'D:/Apps/Nebula',
  name: '星云',
  publisher: 'Fixture Ltd',
  version: '2.0'
}
const shortcut = {
  name: '星云',
  path: 'C:/Start/星云.lnk',
  targetPath: 'D:/Apps/Nebula/Nebula.exe'
}
const metadata = {
  ...shortcut,
  launchSignature: 'default',
  argumentSignature: 'default',
  productName: 'Nebula Launcher',
  publisher: 'Fixture Ltd',
  targetExists: true
}
const internal = {
  path: 'D:/Apps/Nebula/app/Nebula.exe',
  label: 'Nebula',
  productName: 'Nebula',
  publisher: 'Fixture Ltd',
  subsystem: 2,
  source: 'app-path' as const
}

describe('registered application ownership, not executable enumeration', () => {
  it('keeps the official launcher and indexes the internal main program only as an alias', () => {
    const result = mergeInstalledApplications([shortcut], [internal], [metadata], [registration])
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe(shortcut.path)
    expect(result[0].aliases).toContain('Nebula')
    expect(result[0].installationIdentity).toBeTruthy()
    expect(result[0].sourcePaths).toContain(internal.path)
  })
  it.each([
    'guard',
    'background',
    'telemetry',
    'watcher',
    'agent',
    'overlay',
    'sandbox',
    'utility',
    'foo'
  ])('does not invent an application from a product-prefixed %s executable', (suffix) => {
    expect(
      isInstalledGuiApplication({
        ...internal,
        source: 'directory',
        path: `D:/Apps/Nebula/Nebula_${suffix}.exe`
      })
    ).toBe(false)
  })
  it('retains a separately installed companion, separate sources and multiple registered versions', () => {
    const companion = {
      ...internal,
      path: 'D:/Apps/NebulaWork/NebulaWork.exe',
      label: 'NebulaWork',
      productName: 'NebulaWork'
    }
    const version = { ...internal, path: 'D:/Apps/Nebula3/Nebula.exe' }
    const result = mergeInstalledApplications(
      [shortcut],
      [internal, companion, version],
      [metadata],
      [
        registration,
        { ...registration, id: 'version3', root: 'D:/Apps/Nebula3' },
        { ...registration, id: 'work', root: 'D:/Apps/NebulaWork' }
      ]
    )
    expect(result).toHaveLength(3)
  })
  it('does not merge independent products sharing one suite registration', () => {
    const other = {
      ...internal,
      path: 'D:/Apps/Nebula/Editor.exe',
      label: 'Editor',
      productName: 'Editor'
    }
    expect(
      mergeInstalledApplications([shortcut], [internal, other], [metadata], [registration])
    ).toHaveLength(2)
  })
  it('uses exact target evidence when product metadata for the shortcut is temporarily unavailable', () => {
    expect(
      mergeInstalledApplications(
        [shortcut],
        [{ ...internal, path: shortcut.targetPath }],
        [],
        [registration]
      )
    ).toHaveLength(1)
  })
  it('does not confuse a similarly prefixed directory or a different publisher with the installation', () => {
    expect(
      installationIdentity('D:/Apps/NebulaOther/app.exe', 'Nebula', 'Fixture Ltd', [registration])
    ).toBeUndefined()
    expect(installationIdentity(internal.path, 'Nebula', 'Different Ltd', [registration])).not.toBe(
      installationIdentity(internal.path, 'Nebula', 'Fixture Ltd', [registration])
    )
    expect(
      installationIdentity(internal.path, 'Electron', 'Fixture Ltd', [registration])
    ).toBeUndefined()
  })
  it('leaves ambiguous overlapping registrations independent', () => {
    expect(
      installationIdentity(internal.path, 'Nebula', 'Fixture Ltd', [
        registration,
        { ...registration, id: 'other-source' }
      ])
    ).toBeUndefined()
  })
  it('reinstall removes confirmed dead shortcuts, keeps the current one and never deletes user files', () => {
    const old = {
      ...shortcut,
      path: 'C:/Desktop/Old.lnk',
      targetPath: 'D:/Apps/Nebula/old/Nebula.exe'
    }
    const result = mergeInstalledApplications(
      [old, shortcut],
      [internal],
      [{ ...metadata, ...old, targetExists: false }, metadata],
      [registration]
    )
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe(shortcut.path)
    expect(old.path).toBe('C:/Desktop/Old.lnk')
    // A racing target change must never attach the previous target's missing-state to a new target.
    expect(
      mergeInstalledApplications(
        [shortcut],
        [],
        [{ ...metadata, targetPath: old.targetPath, targetExists: false }],
        [registration]
      )
    ).toHaveLength(1)
  })
  it('retains separate hosted apps within the same installed host', () => {
    const entries = ['Canvas', 'Notebook'].map((name, index) => ({
      ...shortcut,
      name,
      path: `C:/Start/${name}.lnk`,
      launchSignature: String(index).repeat(64),
      argumentSignature: String(index).repeat(64)
    }))
    const details = entries.map((entry) => ({ ...metadata, ...entry }))
    expect(mergeInstalledApplications(entries, [internal], details, [registration])).toHaveLength(2)
  })
  it('preserves independent official suite entry points even when all their product metadata matches', () => {
    const entries = ['Writer', 'Sheet', 'Slides'].map((name) => ({
      ...shortcut,
      name,
      path: `C:/Start/${name}.lnk`,
      targetPath: `D:/Apps/Nebula/${name}.exe`
    }))
    const details = entries.map((entry) => ({ ...metadata, ...entry, productName: 'Nebula Suite' }))
    const result = mergeInstalledApplications(entries, [], details, [registration])
    expect(result).toHaveLength(3)
    expect(new Set(result.map((x) => x.applicationId)).size).toBe(3)
  })
  it('leaves packaged activation to the Store scanner rather than inventing a second raw executable', () => {
    expect(
      isInstalledGuiApplication({
        ...internal,
        path: 'C:/Program Files/WindowsApps/Fixture_1_x64__id/Fixture.exe'
      })
    ).toBe(false)
  })
  it('preserves an independent suite component even if only the other component has a shortcut', () => {
    const writer = { ...metadata, productName: 'Nebula Suite', description: 'Nebula Writer' }
    const sheet = {
      ...internal,
      path: 'D:/Apps/Nebula/Sheet.exe',
      label: 'Sheet',
      productName: 'Nebula Suite',
      description: 'Nebula Sheet'
    }
    const result = mergeInstalledApplications([shortcut], [sheet], [writer], [registration])
    expect(result).toHaveLength(2)
    expect(result.some((entry) => entry.path === sheet.path)).toBe(true)
  })
  it('keeps a suite configuration tool while associating the internal main executable with its public launcher', () => {
    const config = {
      ...shortcut,
      name: 'Configuration',
      path: 'C:/Start/Configuration.lnk',
      targetPath: 'D:/Apps/Nebula/config.exe'
    }
    const details = [
      { ...metadata, description: 'Nebula' },
      { ...metadata, ...config, description: 'Nebula Configuration' }
    ]
    const result = mergeInstalledApplications(
      [shortcut, config],
      [{ ...internal, description: 'Nebula' }],
      details,
      [registration]
    )
    expect(result.map((x) => x.name)).toEqual(['星云', 'Configuration'])
  })
  it('supports new products, nested runtime versions and reordered sources without adding brand rules', () => {
    for (let index = 0; index < 40; index++) {
      const root = `D:/Installed/Vendor${index}/Product${index}`
      const entry = {
        name: `产品${index}`,
        path: `C:/Start/Product${index}.lnk`,
        targetPath: `${root}/Product${index}.exe`
      }
      const detail = { ...metadata, ...entry, productName: `Product${index} Launcher` }
      const candidates = [
        `${root}/app/Product${index}.exe`,
        `${root}/app-2.4.0/Product${index}.exe`
      ].map((path) => ({
        ...internal,
        path,
        productName: `Product${index}`,
        label: `Product${index}`
      }))
      const owner = { ...registration, id: `product${index}`, root }
      for (const ordered of [candidates, [...candidates].reverse()])
        expect(mergeInstalledApplications([entry], ordered, [detail], [owner])).toHaveLength(1)
      expect(mergeInstalledApplications([], candidates, [], [owner])).toHaveLength(1)
    }
  })
})
