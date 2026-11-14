import { describe, expect, it } from 'vitest'
import {
  applicationLaunchKey,
  deduplicateApplications,
  normalizeApplicationPath
} from '../../src/shared/applicationIdentity'

describe('shared application identity', () => {
  const primary = {
    name: 'Aurora',
    path: 'C:/Start/Aurora.lnk',
    targetPath: 'C:/Apps/Aurora.exe',
    launchSignature: 'default',
    icon: 'original-icon'
  }
  it('collapses verified shortcut copies and a manual executable while retaining the original launcher', () => {
    expect(
      deduplicateApplications([
        primary,
        { ...primary, path: 'C:/Desktop/Aurora.lnk' },
        { name: 'aurora', path: 'c:\\apps\\AURORA.exe' }
      ])
    ).toEqual([primary])
  })
  it('retains unknown shortcut identities rather than inferring arguments from the target', () => {
    const unknown = { ...primary, launchSignature: undefined }
    expect(applicationLaunchKey(unknown)).toBeNull()
    expect(
      deduplicateApplications([unknown, { ...unknown, path: 'C:/Other/Aurora.lnk' }])
    ).toHaveLength(2)
  })
  it.each(['profile-a', 'elevated', 'custom-working-directory', 'minimized'])(
    'retains special launch settings: %s',
    (signature) => {
      expect(
        deduplicateApplications([
          primary,
          { ...primary, path: 'C:/Special/Aurora.lnk', launchSignature: signature }
        ])
      ).toHaveLength(2)
    }
  )
  it('retains aliases, separate installations, channels, and store identifiers', () => {
    expect(
      deduplicateApplications([
        primary,
        { ...primary, name: 'Work Aurora' },
        { ...primary, path: 'C:/Start/Aurora2.lnk', targetPath: 'D:/Apps/Aurora.exe' },
        { name: 'Aurora', path: 'uwp:Publisher.Aurora' },
        { name: 'Aurora', path: 'uwp:Publisher.AuroraBeta' }
      ])
    ).toHaveLength(5)
  })
  it('normalizes Windows slashes, casing and quoting but preserves case-sensitive paths and URLs', () => {
    expect(normalizeApplicationPath('"C:/Apps/Aurora.exe"')).toBe('c:\\apps\\aurora.exe')
    expect(normalizeApplicationPath('\\\\Server\\Apps\\Aurora.exe')).toBe(
      '\\\\server\\apps\\aurora.exe'
    )
    expect(
      deduplicateApplications([
        { name: 'App', path: '/apps/App' },
        { name: 'App', path: '/apps/app' },
        { name: 'App', path: 'https://example.com/App' },
        { name: 'App', path: 'https://example.com/app' }
      ])
    ).toHaveLength(4)
  })
})
