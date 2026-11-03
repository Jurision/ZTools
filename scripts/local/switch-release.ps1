param(
    [ValidateSet('Preview','Activate','Rollback')] [string]$Action = 'Preview',
    [string]$ReleasePath,
    [string]$InstalledExe = "$env:LOCALAPPDATA\Programs\ZTools\ZTools.exe"
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releases = [IO.Path]::GetFullPath((Join-Path $root '.local-work\releases')) + [IO.Path]::DirectorySeparatorChar
if (!$ReleasePath) { $ReleasePath = (Get-Content -LiteralPath (Join-Path $root '.local-work\latest-release.txt') -Raw).Trim() }
$release = [IO.Path]::GetFullPath($ReleasePath)
if (!$release.StartsWith($releases, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release is outside this development workspace' }
$exe = Join-Path $release 'win-unpacked\ZTools.exe'
if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $InstalledExe)) { throw 'Release or original installation missing' }
if ($Action -eq 'Preview') { Write-Output "Ready: $exe`nOriginal: $InstalledExe`nActivate requires ZTools to be closed. No automatic process termination."; return }
if (Get-Process -Name ZTools -ErrorAction SilentlyContinue) { throw 'Close ZTools normally first, so pending plugin data can be saved. No process was stopped.' }
if ($Action -eq 'Activate') {
    $manifest = Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw | ConvertFrom-Json
    foreach ($entry in $manifest) {
        $artifact = [IO.Path]::GetFullPath((Join-Path $release $entry.path))
        if (!$artifact.StartsWith($release + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid artifact path in release manifest' }
        if (!(Test-Path -LiteralPath $artifact) -or (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Release integrity check failed: $($entry.path)" }
    }
    # Copy the closed profile once; keep the original app bytes untouched for rollback.
    $profile = Join-Path $env:USERPROFILE '.ztools'
    $backup = Join-Path $root ('.local-work\backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    if (Test-Path -LiteralPath $profile) { Copy-Item -LiteralPath $profile -Destination (Join-Path $backup 'profile') -Recurse }
    @{originalExe=$InstalledExe;releaseExe=$exe;backup=$backup;activatedAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root '.local-work\active-release.json') -Encoding utf8
    Start-Process -FilePath $exe -WindowStyle Hidden
    Write-Output "Started local release. Profile backup: $backup. Windows startup settings were not changed."
} else {
    # Do not restore stale profile data automatically: newer user calculations must survive rollback.
    Start-Process -FilePath $InstalledExe -WindowStyle Hidden
    Write-Output 'Started original installation; current user data retained. Profile backups are available for deliberate recovery only.'
}
