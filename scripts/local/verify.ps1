param([switch]$InstallDependencies)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $root
try {
    $initialFingerprint = & node scripts/local/source-fingerprint.cjs
    if ($LASTEXITCODE -or $initialFingerprint -notmatch '^[a-f0-9]{64}$') { throw 'Cannot fingerprint source' }
    # Keep each failed stage blocking; no packaging is used for E2E.
    if ($InstallDependencies) {
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE) { throw 'Root dependency installation failed' }
        & pnpm --dir internal-plugins/setting install --frozen-lockfile
        if ($LASTEXITCODE) { throw 'Settings dependency installation failed' }
    }
    & pnpm typecheck
    if ($LASTEXITCODE) { throw 'Typecheck failed' }
    & pnpm --dir internal-plugins/setting exec vue-tsc --noEmit
    if ($LASTEXITCODE) { throw 'Settings typecheck failed' }
    & pnpm test
    if ($LASTEXITCODE) { throw 'Unit tests failed' }
    & node --test local-plugins/calculation-paper-next/core.test.cjs
    if ($LASTEXITCODE) { throw 'Calculation paper tests failed' }
    & node --test local-plugins/calculation-paper-history/history.test.cjs
    if ($LASTEXITCODE) { throw 'Original paper history tests failed' }
    & node scripts/local/build-paper-history.cjs
    if ($LASTEXITCODE) { throw 'Original paper history build failed' }
    & pnpm exec electron-vite build
    if ($LASTEXITCODE) { throw 'Source build failed' }
    $env:ZTOOLS_BACKGROUND_TEST = '1'
    & pnpm exec playwright test --config=playwright.e2e.config.ts tests/e2e/background-runtime.spec.ts tests/e2e/local-background.spec.ts tests/e2e/super-panel-layout.spec.ts tests/e2e/quick-search.spec.ts tests/e2e/quick-provider-settings.spec.ts tests/e2e/quick-calculation-paper.spec.ts tests/e2e/file-search.spec.ts
    if ($LASTEXITCODE) { throw 'Background E2E failed' }
    $finalFingerprint = & node scripts/local/source-fingerprint.cjs
    if ($LASTEXITCODE -or $finalFingerprint -notmatch '^[a-f0-9]{64}$') { throw 'Cannot fingerprint verified source' }
    if ($initialFingerprint -ne $finalFingerprint) { throw 'Source changed during verification; rerun after edits finish' }
    New-Item -ItemType Directory -Path '.local-work' -Force | Out-Null
    @{ verifiedAt = (Get-Date).ToString('o'); commit = (& git rev-parse HEAD); fingerprint = $finalFingerprint; note = 'Working tree verification; stage separately after review' } | ConvertTo-Json | Set-Content '.local-work/verification.json' -Encoding utf8
} finally {
    Remove-Item Env:ZTOOLS_BACKGROUND_TEST -ErrorAction SilentlyContinue
    Pop-Location
}
