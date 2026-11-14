import { expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

it.skipIf(process.platform !== 'win32')(
  'updates managed links before startup and retains reversible originals without touching unrelated targets',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ztools-release-links-'))
    try {
      const script = path.join(root, 'fixture.ps1')
      await writeFile(
        script,
        `param([string]$Root,[string]$Helper)
$ErrorActionPreference='Stop'
. $Helper
$shell=New-Object -ComObject WScript.Shell
$original=Join-Path $Root 'official/ZTools.exe'
$release=Join-Path $Root 'releases/new/ZTools.exe'
$old=Join-Path $Root 'releases/old/ZTools.exe'
$other=Join-Path $Root 'releases-other/ZTools.exe'
$backup=Join-Path $Root 'backup'
New-Item -ItemType Directory -Path $backup | Out-Null
$links=@()
foreach($entry in @(@{name='official';target=$original},@{name='old';target=$old},@{name='other';target=$other})) {
 $link=Join-Path $Root ($entry.name+'.lnk'); $s=$shell.CreateShortcut($link); $s.TargetPath=$entry.target; $s.Arguments='--fixture'; $s.Save(); $links+=$link
}
$updated=@(Set-ReleaseShortcuts -Links $links -ReleaseExe $release -ReleasesRoot (Join-Path $Root 'releases') -OriginalExe $original -BackupDirectory $backup)
@{updated=$updated.Count;targets=@($links|ForEach-Object{$shell.CreateShortcut($_).TargetPath});arguments=@($links|ForEach-Object{$shell.CreateShortcut($_).Arguments});backupTargets=@(Get-ChildItem -LiteralPath $backup -Filter '*.lnk'|ForEach-Object{$shell.CreateShortcut($_.FullName).TargetPath});expected=$release;other=$other;old=$old;original=$original}|ConvertTo-Json -Compress
`
      )
      const { stdout } = await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          root,
          path.resolve('scripts/local/release-shortcuts.ps1')
        ],
        { windowsHide: true, timeout: 10000 }
      )
      const result = JSON.parse(stdout.replace(/^\uFEFF/, ''))
      expect(result.updated).toBe(2)
      expect(result.targets).toEqual([result.expected, result.expected, result.other])
      expect(result.arguments).toEqual(['--fixture', '--fixture', '--fixture'])
      expect(result.backupTargets.sort()).toEqual([result.original, result.old].sort())
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)
