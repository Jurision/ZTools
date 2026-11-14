import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {} }))
vi.mock('../../src/main/utils/common', () => ({ extractAcronym: (value: string) => value }))
import { mergeInstalledApplications } from '../../src/main/core/commandScanner/windowsInstalledApps'
import { deduplicateApplications } from '../../src/shared/applicationIdentity'
import { annotateApplicationChoices } from '../../src/shared/applicationPresentation'

describe('application installation versus shortcut multiplicity', () => {
  it('keeps 1, 3 and 10 installations even with identical names, vendors and versions', () => {
    for (let product = 0; product < 20; product++)
      for (const count of [1, 3, 10]) {
        const name = `Fixture Cloud ${product}`
        const shortcuts = Array.from({ length: count }, (_, install) =>
          ['desktop', 'user-start', 'common-start'].map((source) => ({
            name,
            path: `C:/Fixture/${source}/${install}.lnk`,
            targetPath: `D:/Fixture/Install-${install}/Cloud.exe`
          }))
        ).flat()
        const metadata = shortcuts.map((x) => ({
          ...x,
          productName: name,
          publisher: 'Fixture Vendor',
          productVersion: '1.0',
          description: name,
          launchSignature: 'default',
          argumentSignature: 'default'
        }))
        const candidates = Array.from({ length: count }, (_, install) => ({
          path: `D:/Fixture/Install-${install}/Cloud.exe`,
          label: name,
          source: 'registered' as const,
          subsystem: 2,
          productName: name,
          description: name,
          publisher: 'Fixture Vendor',
          productVersion: '1.0'
        }))
        const registrations = candidates.map((x, index) => ({
          id: `Fixture-${index}`,
          root: `D:/Fixture/Install-${index}`,
          name
        }))
        for (const ordered of [shortcuts, [...shortcuts].reverse()]) {
          const results = annotateApplicationChoices(
            mergeInstalledApplications(ordered, candidates, metadata, registrations)
          )
          expect(results).toHaveLength(count)
          expect(new Set(results.map((x) => x.targetPath)).size).toBe(count)
          if (count > 1) expect(new Set(results.map((x) => x.applicationDetail)).size).toBe(count)
        }
      }
  })
  it('keeps independent native, hosted and store applications and distinct hosted destinations', () => {
    const name = 'Fixture Cloud'
    const routes = [
      {
        name,
        path: 'C:/Native.lnk',
        targetPath: 'D:/Native/Cloud.exe',
        argumentSignature: 'default'
      },
      {
        name,
        path: 'C:/Hosted.lnk',
        targetPath: 'D:/Host/Launcher.exe',
        argumentSignature: 'cloud'
      },
      { name, path: 'uwp:FixtureCloud!App' },
      {
        name: 'Fixture Notes',
        path: 'C:/Notes.lnk',
        targetPath: 'D:/Host/Launcher.exe',
        argumentSignature: 'notes'
      }
    ]
    const results = deduplicateApplications([...routes, ...routes.map((x) => ({ ...x }))])
    expect(results).toHaveLength(4)
    expect(results.filter((x) => x.name === name)).toHaveLength(3)
  })
  it('describes hosted application sources without presenting the host version as the app version', () => {
    const results = annotateApplicationChoices([
      { name: 'Fixture Cloud', path: 'C:/Native.exe', targetVersion: '1.0' },
      {
        name: 'Fixture Cloud',
        path: 'C:/Host.lnk',
        targetProductName: 'Fixture Android Host',
        targetVersion: '99.0',
        argumentSignature: 'cloud'
      }
    ])
    expect(results.map((x) => x.applicationDetail)).toEqual([
      '版本 1.0',
      '通过 Fixture Android Host 启动'
    ])
  })
})
