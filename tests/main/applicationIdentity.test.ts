import { describe, expect, it } from 'vitest'
import {
  applicationLaunchKey,
  deduplicateApplications,
  normalizeApplicationPath
} from '../../src/shared/applicationIdentity'

const primary = {
  name: 'Aurora',
  path: 'C:/Start/Aurora.lnk',
  targetPath: 'C:/Apps/Aurora.exe',
  launchSignature: 'default',
  argumentSignature: 'default',
  icon: 'original-icon'
}

describe('installation identity independent of names and sources', () => {
  it('keeps one canonical shortcut and searchable names across desktop, registry, and manual entries', () => {
    const entries = [
      primary,
      { ...primary, name: 'Aurora 2027', path: 'C:/Desktop/Aurora.lnk' },
      { name: 'Aurora Professional', path: 'c:/apps/AURORA.exe' }
    ]
    const result = deduplicateApplications(entries)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject(primary)
    expect(result[0].aliases).toEqual(['Aurora 2027', 'Aurora Professional'])
    expect(primary).not.toHaveProperty('aliases')
    expect(deduplicateApplications(result)).toEqual(result)
  })
  it.each(['custom-working-directory', 'minimized', 'elevated'])(
    'keeps %s as an optional launch action, not another app',
    (launchSignature) => {
      const result = deduplicateApplications([
        { ...primary, path: 'C:/Other/Aurora.lnk', launchSignature },
        primary
      ])
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe(primary.path)
      expect(result[0].launchVariants).toHaveLength(2)
    }
  )
  it('groups same-name profiles while preserving their exact shortcut actions', () => {
    const entries = ['a', 'b'].map((id) => ({
      ...primary,
      path: `C:/Start/Profile-${id}.lnk`,
      launchSignature: id.repeat(64),
      argumentSignature: id.repeat(64)
    }))
    const result = deduplicateApplications(entries)
    expect(result).toHaveLength(1)
    expect(result[0].launchVariants?.map((item) => item.path)).toEqual(
      entries.map((item) => item.path)
    )
  })
  it('never chooses elevation as default when a normal shortcut also has a custom workdir', () => {
    const result = deduplicateApplications([
      {
        ...primary,
        name: 'Aurora (Admin)',
        path: 'C:/Start/Admin.lnk',
        launchSignature: 'a'.repeat(64),
        runAsAdmin: true
      },
      { ...primary, launchSignature: 'b'.repeat(64), runAsAdmin: false }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe(primary.path)
    expect(result[0].launchVariants?.[1].runAsAdmin).toBe(true)
  })
  it('keeps differently named hosted apps, game destinations and script commands with different arguments', () => {
    const entries = ['Drawing', 'Notebook', 'Game'].map((name, index) => ({
      ...primary,
      name,
      path: `C:/Start/${name}.lnk`,
      argumentSignature: String(index).repeat(64),
      launchSignature: String(index).repeat(64)
    }))
    expect(deduplicateApplications(entries)).toHaveLength(3)
  })
  it('keeps separate installs, versions, portable copies and Store sources even with equal names', () => {
    const entries = [
      primary,
      ...[
        'C:/Apps/v2/Aurora.exe',
        'D:/Portable/Aurora.exe',
        'uwp:Publisher.Aurora',
        'uwp:Other.Aurora'
      ].map((path) => ({ name: 'Aurora', path }))
    ]
    expect(deduplicateApplications(entries)).toHaveLength(5)
  })
  it('merges renamed entries for the exact app protocol while retaining different destinations', () => {
    const result = deduplicateApplications([
      { name: 'Game A', path: 'gameclient://run/123' },
      { name: '游戏甲', path: 'gameclient://run/123' },
      { name: 'Game B', path: 'gameclient://run/456' }
    ])
    expect(result).toHaveLength(2)
    expect(result[0].aliases).toEqual(['游戏甲'])
  })
  it('preserves uncertain same-name shortcut actions within one installation group', () => {
    const unknown = { ...primary, launchSignature: undefined, argumentSignature: undefined }
    expect(applicationLaunchKey(unknown)).toBeNull()
    const result = deduplicateApplications([unknown, { ...unknown, path: 'C:/Other/Aurora.lnk' }])
    expect(result).toHaveLength(1)
    expect(result[0].launchVariants).toHaveLength(2)
  })
  it('does not treat a shared alias as proof that two hosted apps are identical', () => {
    expect(
      deduplicateApplications(
        ['Drawing', 'Notebook'].map((name, index) => ({
          ...primary,
          name,
          aliases: ['work'],
          path: `C:/Start/${name}.lnk`,
          argumentSignature: String(index).repeat(64)
        }))
      )
    ).toHaveLength(2)
  })
  it('preserves matching through alternative names when new applications are rescanned', () => {
    const initial = deduplicateApplications([primary])
    const newApp = { name: 'Future App', path: 'D:/New/App.exe' }
    const refreshed = deduplicateApplications([
      ...initial,
      newApp,
      { ...newApp, name: 'Future App 3.0' }
    ])
    expect(refreshed).toHaveLength(2)
    expect(refreshed[1].aliases).toContain('Future App 3.0')
  })
  it('normalizes Windows paths while preserving case-sensitive non-Windows targets', () => {
    expect(normalizeApplicationPath('"C:/Apps/Aurora.exe"')).toBe('c:\\apps\\aurora.exe')
    expect(
      deduplicateApplications([
        { name: 'App', path: '/apps/App' },
        { name: 'App', path: '/apps/app' },
        { name: 'App', path: 'https://example.com/App' },
        { name: 'App', path: 'https://example.com/app' }
      ])
    ).toHaveLength(4)
  })
  it('applies the same invariant to 100 future products regardless of enumeration order', () => {
    const entries = Array.from({ length: 100 }, (_, index) => {
      const targetPath = `D:/Installed/Product${index}/App.exe`
      return [
        {
          name: `Product ${index}`,
          path: `C:/Start/Product${index}.lnk`,
          targetPath,
          launchSignature: 'default',
          argumentSignature: 'default'
        },
        {
          name: `Product ${index} 8.2`,
          path: `C:/Desktop/Product${index}.lnk`,
          targetPath,
          launchSignature: 'default',
          argumentSignature: 'default'
        },
        {
          name: `我的工具 ${index}`,
          path: `C:/Start/Admin${index}.lnk`,
          targetPath,
          launchSignature: 'a'.repeat(64),
          argumentSignature: 'default'
        },
        { name: `Product ${index} Portable`, path: targetPath }
      ]
    }).flat()
    for (const ordered of [
      entries,
      [...entries].reverse(),
      [...entries.slice(73), ...entries.slice(0, 73)]
    ]) {
      const grouped = deduplicateApplications(ordered)
      expect(grouped).toHaveLength(100)
      expect(
        grouped.every((item) => item.aliases?.length === 3 && item.launchVariants?.length === 2)
      ).toBe(true)
      expect(deduplicateApplications(grouped)).toEqual(grouped)
    }
  })
})
