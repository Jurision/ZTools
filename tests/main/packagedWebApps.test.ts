import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))
import {
  mergePackagedWebApps,
  readPackagedWebAppIdentities
} from '../../src/main/core/commandScanner/packagedWebApps'

/**
 * Escape fixture attribute values, including quoted profiles and XML entity examples.
 * @param value Literal attribute text.
 * @returns XML attribute-safe text.
 */
function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Generate a fake packaged PWA manifest; no real application or profile is accessed.
 * @param options Browser, profile and registration variations.
 * @returns Manifest text for a temporary package folder.
 */
function manifest(
  options: {
    host?: string
    profile?: string
    app?: string
    extra?: string
    store?: boolean
    extensionProfile?: boolean
    extensionApp?: string
    data?: string
  } = {}
): string {
  const { host = 'Browser.Stable!App', profile = 'Default', app = 'fixture-web-app' } = options
  const parameters = `--app-id=${app} --ip-edge-aumid=${host}${options.data ? ` --user-data-dir="${options.data}"` : ''}${options.store ? ' --windows-store-app --display-mode=minimal-ui --app-fallback-url=https://example.invalid/' : ''}${options.extra || ''}`
  const description = `parameters?${parameters.replace(`--app-id=${app}`, `--app-id=${options.extensionApp || app}`)}${options.extensionProfile === false ? '' : `;profile-directory?${profile}`};start-url?https://example.invalid/`
  return `<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"><Applications><Application Id="App" uap10:HostId="PWA" uap10:Parameters="${escape(parameters)}"><Extensions><AppExtension Name="com.ms.webapp.internals.4" Description="${escape(description)}" /></Extensions></Application></Applications></Package>`
}

describe('packaged web application identity', () => {
  it.skipIf(process.platform !== 'win32')(
    'reads real temporary XML and merges only identical browser/profile/app targets',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'ztools-pwa-fixtures-'))
      try {
        const cases = [
          ['store', manifest({ store: true })],
          ['browser', manifest()],
          ['dev', manifest({ host: 'Browser.Dev!App' })],
          ['profile', manifest({ profile: '工作 Profile 2' })],
          ['other', manifest({ app: 'another-site' })],
          ['data', manifest({ data: 'D:\\Fixture Profiles' })],
          ['unknown', manifest({ extra: ' --incognito' })],
          ['missing-profile', manifest({ extensionProfile: false })],
          ['conflicting', manifest({ extensionApp: 'different-app' })],
          ['invalid', '<Package broken'],
          [
            'dtd',
            '<!DOCTYPE Package [<!ENTITY bad SYSTEM "file:///C:/must-not-read">]>' + manifest()
          ],
          ['duplicate', manifest({ extra: ' --app-id=other' })],
          ['profile-conflict', manifest({ extra: ' --profile-directory=Other' })],
          ['oversized', ' '.repeat(524289)],
          ['missing', null]
        ] as const
        const requests: { appId: string; installLocation: string }[] = []
        for (const [id, content] of cases) {
          const installLocation = path.join(root, id)
          await mkdir(installLocation)
          if (content !== null)
            await writeFile(path.join(installLocation, 'AppxManifest.xml'), content)
          requests.push({ appId: `${id}!App`, installLocation })
        }
        const identities = await readPackagedWebAppIdentities(requests)
        expect(identities.map((x) => x.appId)).toEqual([
          'store!App',
          'browser!App',
          'dev!App',
          'profile!App',
          'other!App',
          'data!App'
        ])
        expect(identities[0].identity).toBe(identities[1].identity)
        expect(new Set(identities.map((x) => x.identity)).size).toBe(5)
        const entries = requests.map((x) => ({ name: 'Same Name', path: `uwp:${x.appId}` }))
        for (const ordered of [entries, [...entries].reverse()]) {
          const result = mergePackagedWebApps(ordered, identities)
          expect(result).toHaveLength(entries.length - 1)
          const canonical = result.find((x) => x.path === 'uwp:store!App')!
          expect(canonical).toBeTruthy()
          expect((canonical as any).launchVariants.map((x: any) => x.path).sort()).toEqual([
            'uwp:browser!App',
            'uwp:store!App'
          ])
          expect(result.some((x) => x.path === 'uwp:dev!App')).toBe(true)
          expect(mergePackagedWebApps(result, identities)).toEqual(result)
        }
        expect(JSON.stringify(identities)).not.toMatch(/example\.invalid|Fixture Profiles/)
        expect(identities.find((x) => x.appId === 'profile!App')?.browserProfile).toBe(
          '工作 Profile 2'
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    20000
  )
  it('does not read manifests when native entries have no installation metadata', async () => {
    expect(await readPackagedWebAppIdentities([{ appId: 'fixture!App' }])).toEqual([])
  })
  it('retains unresolved registrations and same named native programs', () => {
    const entries = [
      { name: 'App', path: 'uwp:a!App' },
      { name: 'App', path: 'uwp:b!App' },
      { name: 'App', path: 'D:/Apps/App.exe' }
    ]
    expect(mergePackagedWebApps(entries, [])).toEqual(entries)
  })
})
