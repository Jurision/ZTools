param([switch]$SkipVerify)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $root
try {
    if (!$SkipVerify) { & (Join-Path $PSScriptRoot 'verify.ps1') }
    if (!(Test-Path '.local-work/verification.json')) { throw 'Run verify.ps1 successfully before staging' }
    $receipt = Get-Content '.local-work/verification.json' -Raw | ConvertFrom-Json
    $fingerprint = & node scripts/local/source-fingerprint.cjs
    if ($LASTEXITCODE -or $fingerprint -notmatch '^[a-f0-9]{64}$') { throw 'Cannot fingerprint source' }
    if ($receipt.fingerprint -ne $fingerprint) { throw 'Source changed after verification; run verify.ps1 again' }
    & pnpm build
    if ($LASTEXITCODE) { throw 'Build failed' }
    # Packaging is for delivery only, after source Electron verification.
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $release = Join-Path $root ('.local-work/releases/' + $stamp)
    & pnpm exec electron-builder --win --dir --publish never "--config.directories.output=$release"
    if ($LASTEXITCODE) { throw 'Package failed' }
    & node scripts/local/package-plugin.cjs $release
    if ($LASTEXITCODE) { throw 'Plugin packaging failed' }
    Get-ChildItem -LiteralPath $release -Recurse -File | ForEach-Object {
        @{ path = [IO.Path]::GetRelativePath($release, $_.FullName); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $release 'manifest.json') -Encoding utf8
    $release | Set-Content '.local-work/latest-release.txt' -Encoding utf8
    Write-Output "Staged only; running installation unchanged: $release"
} finally { Pop-Location }
