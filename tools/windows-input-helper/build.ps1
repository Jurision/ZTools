[CmdletBinding()]
param(
    [switch]$Test,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'out')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Compile from Windows' bundled .NET Framework; no downloads or installed runtime changes.
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'Windows x64 with the .NET Framework 4.x compiler is required.'
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$sources = @('HoldCopyPaste.cs', 'VoiceSearch.cs', 'MiddleButtonInput.cs') |
    ForEach-Object { Join-Path $PSScriptRoot $_ }
$executable = Join-Path $output 'SmartCopyPaste.exe'
& $compiler /nologo /target:winexe /platform:x64 /r:System.Windows.Forms.dll "/out:$executable" @sources
if ($LASTEXITCODE -ne 0) { throw 'Helper compilation failed.' }

if ($Test) {
    # Alternate entry point cannot install hooks or touch the live helper's AppData files.
    $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('ztools-input-helper-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $runner = Join-Path $testRoot 'SelfTest.exe'
    & $compiler /nologo /target:exe /platform:x64 /r:System.Windows.Forms.dll /main:HelperSelfTest "/out:$runner" @sources (Join-Path $PSScriptRoot 'SelfTest.cs')
    if ($LASTEXITCODE -ne 0) { throw "Self-test compilation failed; artifacts: $testRoot" }
    $stdout = Join-Path $testRoot 'stdout.txt'
    $stderr = Join-Path $testRoot 'stderr.txt'
    # Own the process handle so Windows PowerShell 5.1 also retains a fast child's exit code.
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo.FileName = $runner
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $null = $process.Start()
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(15000)) {
        $process.Kill()
        throw "Self-test timed out; artifacts: $testRoot"
    }
    $process.WaitForExit()
    $testExitCode = $process.ExitCode
    $outputTask.Result | Set-Content -LiteralPath $stdout -Encoding UTF8
    $errorTask.Result | Set-Content -LiteralPath $stderr -Encoding UTF8
    $process.Dispose()
    if ($testExitCode -ne 0) {
        throw "Self-test failed: $(Get-Content -LiteralPath $stderr -Raw); artifacts: $testRoot"
    }
    $result = Get-Content -LiteralPath $stdout -Raw
    if ($result -notmatch '^PASS:') { throw "Self-test returned no passing summary; artifacts: $testRoot" }
    Write-Output $result.Trim()
    Write-Output "Isolated test artifacts: $testRoot"
}

Write-Output "Built (not installed or started): $executable"
Get-FileHash -LiteralPath $executable -Algorithm SHA256 | Select-Object Hash, Path
