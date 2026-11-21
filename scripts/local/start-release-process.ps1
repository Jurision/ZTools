param(
    [Parameter(Mandatory)][string]$Executable,
    [string[]]$Arguments = @()
)
$ErrorActionPreference = 'Stop'
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = (Get-Item -LiteralPath $Executable).FullName
$start.WorkingDirectory = [IO.Path]::GetDirectoryName($start.FileName)
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
# Electron can explicitly attach to its parent even when Windows creates no console.
$start.Environment['ELECTRON_NO_ATTACH_CONSOLE'] = '1'
foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
$process = [Diagnostics.Process]::Start($start)
try { $process.Id } finally { $process.Dispose() }
