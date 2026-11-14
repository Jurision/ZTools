import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Run a hidden fixture-only PowerShell reader with closed stdin and bounded lifetime.
 * @param args Script arguments.
 * @param input JSON input containing only temporary shortcut paths.
 * @returns Captured stdout; no application or shortcut is executed.
 */
function powershell(args: string[], input = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, timeout: 15000, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout.replace(/^\uFEFF/, '')))
    )
    child.stdin?.end(input)
  })
}

describe.skipIf(process.platform !== 'win32')(
  'actual Windows shortcut metadata with temporary fixtures',
  () => {
    it('distinguishes arguments, working directory, window style and elevation without exposing arguments', async () => {
      const tempParent = await mkdtemp(path.join(os.tmpdir(), 'ztools-link-identity-'))
      const root = path.join(tempParent, '中文 应用')
      try {
        await mkdir(path.join(root, 'working'), { recursive: true })
        await writeFile(path.join(root, 'Fixture.exe'), 'not executable - never launched')
        const script = path.join(root, 'create.ps1')
        await writeFile(
          script,
          `param([string]$Root)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
foreach ($name in @('ordinary','duplicate','profile-a','profile-b','working','minimized','elevated','native-target')) {
  $linkPath = Join-Path $Root ($name + '.lnk')
  $link = $shell.CreateShortcut($linkPath)
  $link.TargetPath = Join-Path $Root 'Fixture.exe'
  $link.WorkingDirectory = $Root
  if ($name -like 'profile-*') { $link.Arguments = '--profile=' + $name }
  if ($name -eq 'working') { $link.WorkingDirectory = Join-Path $Root 'working' }
  if ($name -eq 'minimized') { $link.WindowStyle = 7 }
  if ($name -eq 'native-target') { $link.TargetPath = '' }
  $link.Save()
  if ($name -eq 'elevated') {
    $bytes = [IO.File]::ReadAllBytes($linkPath)
    $flags = [BitConverter]::ToUInt32($bytes,20) -bor 0x2000
    [BitConverter]::GetBytes([uint32]$flags).CopyTo($bytes,20)
    [IO.File]::WriteAllBytes($linkPath,$bytes)
  }
}
`
        )
        await powershell(['-File', script, root])
        await writeFile(path.join(root, 'broken.lnk'), 'broken')
        const names = [
          'ordinary',
          'duplicate',
          'profile-a',
          'profile-b',
          'working',
          'minimized',
          'elevated',
          'native-target',
          'broken',
          'missing',
          '未安装😀'
        ]
        const stdout = await powershell(
          ['-File', path.resolve('resources/windows-installed-apps.ps1'), '-ShortcutMetadataOnly'],
          JSON.stringify(
            names.map((name) => ({
              path: path.join(root, name + '.lnk'),
              targetPath: path.join(root, 'Fixture.exe')
            }))
          )
        )
        const result = JSON.parse(stdout)
        expect(result.candidates).toEqual([])
        expect(result.shortcuts).toHaveLength(8)
        expect(
          result.shortcuts
            .filter((item: { runAsAdmin: boolean }) => item.runAsAdmin)
            .map((item: { path: string }) => path.basename(item.path))
        ).toEqual(['elevated.lnk'])
        expect(
          result.shortcuts.every(
            (item: { targetPath: string }) => item.targetPath === path.join(root, 'Fixture.exe')
          )
        ).toBe(true)
        const signatures = new Map<string, string>(
          result.shortcuts.map((item: { path: string; launchSignature: string }) => [
            path.basename(item.path, '.lnk'),
            item.launchSignature
          ])
        )
        expect(signatures.get('ordinary')).toBe('default')
        expect(signatures.get('duplicate')).toBe('default')
        expect(new Set(signatures.values()).size).toBe(6)
        const argumentsByName = new Map<string, string>(
          result.shortcuts.map((item: { path: string; argumentSignature: string }) => [
            path.basename(item.path, '.lnk'),
            item.argumentSignature
          ])
        )
        for (const name of [
          'ordinary',
          'duplicate',
          'working',
          'minimized',
          'elevated',
          'native-target'
        ])
          expect(argumentsByName.get(name)).toBe('default')
        expect(argumentsByName.get('profile-a')).not.toBe(argumentsByName.get('profile-b'))
        expect(stdout).not.toContain('--profile=')
        for (const name of names.slice(2, 7)) expect(signatures.get(name)).toMatch(/^[a-f0-9]{64}$/)
        await rm(path.join(root, 'Fixture.exe'))
        const missingTarget = JSON.parse(
          await powershell(
            [
              '-File',
              path.resolve('resources/windows-installed-apps.ps1'),
              '-ShortcutMetadataOnly'
            ],
            JSON.stringify([
              { path: path.join(root, 'ordinary.lnk'), targetPath: path.join(root, 'Fixture.exe') }
            ])
          )
        )
        expect(missingTarget.shortcuts[0].targetExists).toBe(false)
      } finally {
        await rm(tempParent, { recursive: true, force: true })
      }
    }, 30000)
  }
)

describe.skipIf(process.platform !== 'win32')(
  'registration root parsing without registry access',
  () => {
    it('does not claim a truncated shortcut identity batch is complete', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'ztools-metadata-cap-'))
      try {
        const result = JSON.parse(
          await powershell(
            [
              '-File',
              path.resolve('resources/windows-installed-apps.ps1'),
              '-ShortcutMetadataOnly'
            ],
            JSON.stringify(Array(1801).fill(path.join(root, 'missing.lnk')))
          )
        )
        expect(result.complete).toBe(false)
        expect(result.shortcuts).toEqual([])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
    it('uses specific install/uninstaller/icon ownership and rejects system or broad roots', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'ztools-registration-'))
      try {
        const script = path.join(root, 'registration.ps1')
        await writeFile(
          script,
          `param([string]$Source)
$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$null,[ref]$null)
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-RegistrationRoot'},$true)
. ([scriptblock]::Create($definition.Extent.Text))
$fixtures=@(
 @{InstallLocation='D:\\Installed\\Product';DisplayIcon='C:\\Other\\Icon.ico'},
 @{DisplayIcon='"D:\\Installed\\Product\\icon.ico"'},
 @{UninstallString='"D:\\Installed\\Product\\uninstall.exe" /silent';DisplayIcon='D:\\Installed\\Product\\app\\main.exe'},
 @{UninstallString='C:\\Windows\\System32\\msiexec.exe /X secret';DisplayIcon='D:\\Installed\\Product\\main.exe'},
 @{InstallLocation='D:\\APP';DisplayIcon='C:\\Windows\\system32\\foo.exe'}
)
$result=@($fixtures | ForEach-Object {Get-RegistrationRoot $_})
ConvertTo-Json -InputObject $result -Compress
`
        )
        expect(
          JSON.parse(
            await powershell([
              '-File',
              script,
              path.resolve('resources/windows-installed-apps.ps1')
            ])
          )
        ).toEqual([...Array(4).fill('D:\\Installed\\Product'), null])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
)
