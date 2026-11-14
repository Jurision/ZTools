import { describe, expect, it } from 'vitest'
import {
  deduplicateApplications,
  launcherDestinationKey
} from '../../src/shared/applicationIdentity'
import { annotateApplicationChoices } from '../../src/shared/applicationPresentation'

const legacy = {
  name: '星际旅程',
  path: 'C:/Start/Legacy.lnk',
  targetPath: 'D:/Game/launcher.exe',
  targetProductName: '星际旅程',
  targetPublisher: 'Fixture Studio',
  targetVersion: '9.8',
  launchSignature: 'default',
  argumentSignature: 'default'
}
const unified = {
  ...legacy,
  path: 'C:/Start/Unified.lnk',
  targetPath: 'D:/Platform/launcher.exe',
  targetProductName: 'Fixture Launcher',
  targetVersion: '1.2',
  launchSignature: 'a'.repeat(64),
  argumentSignature: 'a'.repeat(64)
}

describe('logical destination versus launcher entry', () => {
  it('groups old/unified launchers of one publisher without using launcher versions as game versions', () => {
    for (const entries of [
      [legacy, unified],
      [unified, legacy]
    ]) {
      const result = deduplicateApplications(entries)
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe(unified.path)
      expect(result[0].launchVariants?.map((x) => x.path).sort()).toEqual(
        [legacy.path, unified.path].sort()
      )
      expect(result[0].launchVariants?.map((x) => x.entryLabel)).toEqual([
        'Fixture Launcher',
        '星际旅程'
      ])
      expect(deduplicateApplications(result)).toEqual(result)
    }
  })
  it('keeps different games, editions, regions, publishers and independently installed ordinary executables', () => {
    expect(
      deduplicateApplications([
        unified,
        { ...unified, name: 'Another Game', path: 'C:/Start/Other.lnk', argumentSignature: 'b' },
        {
          ...legacy,
          name: '星际旅程 国际版',
          targetPath: 'D:/Global/launcher.exe',
          path: 'C:/Global.lnk'
        },
        {
          ...legacy,
          targetPublisher: 'Other Publisher',
          targetPath: 'D:/OtherVendor/launcher.exe',
          path: 'C:/OtherVendor.lnk'
        },
        { ...legacy, targetPath: 'D:/One/Game.exe' },
        { ...legacy, targetPath: 'D:/Two/Game.exe' }
      ])
    ).toHaveLength(6)
    expect(launcherDestinationKey({ ...legacy, targetPublisher: undefined })).toBeNull()
    expect(launcherDestinationKey({ ...legacy, name: 'Launcher' })).toBeNull()
    expect(launcherDestinationKey({ ...legacy, targetPath: 'D:/one/Game.exe' })).toBeNull()
  })
  it('recognizes launcher destinations independently of language, registration order and future product names', () => {
    for (let index = 0; index < 100; index++) {
      const first = {
        ...legacy,
        name: `Future ${index}`,
        targetProductName: `Future ${index}`,
        targetPublisher: `Vendor ${index}`
      }
      const second = {
        ...unified,
        name: `Ｆｕｔｕｒｅ ${index}`,
        targetPublisher: `VENDOR ${index}`
      }
      expect(deduplicateApplications([first, second])).toHaveLength(1)
    }
  })
  it('does not collapse multiple same-named launcher installs or ambiguous platform destinations', () => {
    const otherInstall = {
      ...legacy,
      path: 'C:/Start/OtherVersion.lnk',
      targetPath: 'E:/Game/launcher.exe',
      targetVersion: '8.1'
    }
    const otherPlatform = {
      ...unified,
      path: 'C:/Start/OtherRegion.lnk',
      argumentSignature: 'different-region',
      launchSignature: 'different-region'
    }
    expect(deduplicateApplications([legacy, otherInstall])).toHaveLength(2)
    expect(deduplicateApplications([unified, otherPlatform])).toHaveLength(1) // Same-host variants retain the existing menu behavior.
    expect(deduplicateApplications([legacy, otherInstall, unified])).toHaveLength(3)
    expect(deduplicateApplications([legacy, unified, otherPlatform])).toHaveLength(2)
  })
  it('adds distinct source details only to retained collisions and recalculates them on refresh', () => {
    const apps = [
      { name: 'Editor', path: 'C:/Editor.exe', targetVersion: '1.2' },
      { name: 'Editor', path: 'D:/Editor.exe', targetVersion: '2.1' },
      {
        name: 'Website',
        path: 'uwp:one!App',
        webBrowserHost: 'Microsoft.MicrosoftEdge.Stable_a!App',
        webBrowserProfile: 'Default'
      },
      {
        name: 'Website',
        path: 'uwp:two!App',
        webBrowserHost: 'microsoft.microsoftedge.dev_a!App',
        webBrowserProfile: 'Default'
      },
      { name: 'Unique', path: 'D:/Unique.exe' }
    ]
    const result = annotateApplicationChoices(apps)
    expect(result.map((x) => x.applicationDetail)).toEqual([
      '版本 1.2',
      '版本 2.1',
      'Edge 正式版',
      'Edge Dev',
      undefined
    ])
    expect(annotateApplicationChoices([result[0]])[0].applicationDetail).toBeUndefined()
  })
  it('uses exact paths or activation IDs when metadata cannot explain same-name independent results', () => {
    const result = annotateApplicationChoices([
      { name: 'App', path: 'C:/A/App.exe' },
      { name: 'App', path: 'D:/A/App.exe' },
      { name: 'System', path: 'uwp:system!FunctionA' },
      { name: 'System', path: 'uwp:system!FunctionB' }
    ])
    expect(new Set(result.map((x) => x.applicationDetail)).size).toBe(4)
    expect(result[0].applicationDetail).toContain('c:\\a\\app.exe')
    expect(result[2].applicationDetail).toBe('FunctionA')
  })
})
