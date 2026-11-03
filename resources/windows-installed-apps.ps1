$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$script:truncated = $false
$timer = [Diagnostics.Stopwatch]::StartNew()
$items = [System.Collections.Generic.List[object]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
# Collect bounded candidates only; metadata inspection never starts an application.
<#
Read executable metadata without running the candidate.
@param candidate Registered executable or icon path.
@param label Product or containing folder label.
@param source Discovery source identity.
@returns No value; appends bounded metadata candidates.
#>
function Add-Candidate([string]$candidate, [string]$label, [string]$source) {
  if ($timer.ElapsedMilliseconds -ge 10000 -or $items.Count -ge 1800) { $script:truncated = $true; return }
  if ([string]::IsNullOrWhiteSpace($candidate)) { return }
  $candidate = [Environment]::ExpandEnvironmentVariables($candidate.Trim())
  if ($candidate -match '^"([^"]+\.exe)"(?:\s*,\s*-?\d+)?$') { $candidate = $Matches[1] }
  elseif ($candidate -match '^(.*\.exe)\s*,\s*-?\d+$') { $candidate = $Matches[1] }
  try {
  if ($candidate -notmatch '^[a-zA-Z]:[\\/]' -or ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($candidate))).DriveType -ne 'Fixed') { return }
  if (-not [IO.Path]::IsPathRooted($candidate) -or [IO.Path]::GetExtension($candidate) -ine '.exe' -or -not $seen.Add("$source|$candidate")) { return }
    $file = Get-Item -LiteralPath $candidate -ErrorAction Stop
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return }
    $stream = [IO.File]::Open($candidate, 'Open', 'Read', 'ReadWrite')
    try {
      $reader = [IO.BinaryReader]::new($stream)
      if ($reader.ReadUInt16() -ne 0x5A4D) { return }
      $stream.Position = 0x3C; $pe = $reader.ReadInt32()
      if ($pe -lt 64 -or $pe + 94 -gt $stream.Length) { return }
      $stream.Position = $pe
      if ($reader.ReadUInt32() -ne 0x4550) { return }
      $stream.Position = $pe + 92
      $subsystem = $reader.ReadUInt16()
    } finally { $stream.Dispose() }
    $info = $file.VersionInfo
    $items.Add([pscustomobject]@{path=$file.FullName; label=$label; source=$source; subsystem=$subsystem; productName=$info.ProductName; description=$info.FileDescription; originalFilename=$info.OriginalFilename})
  } catch { }
}
<#
Inspect a single known installation directory without recursion.
@param directory Existing fixed-drive directory.
@param label Registered product or folder name.
@returns No value; collects bounded executable metadata.
#>
function Scan-Directory([string]$directory, [string]$label) {
  if ($timer.ElapsedMilliseconds -ge 10000) { $script:truncated = $true; return }
  if ([string]::IsNullOrWhiteSpace($directory)) { return }
  try {
    if ($directory -notmatch '^[a-zA-Z]:[\\/]' -or ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($directory))).DriveType -ne 'Fixed') { return }
    $dir = Get-Item -LiteralPath $directory -ErrorAction Stop
    if (-not $dir.PSIsContainer -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return }
    Get-ChildItem -LiteralPath $directory -File -Filter '*.exe' -ErrorAction SilentlyContinue | Select-Object -First 60 | ForEach-Object { Add-Candidate $_.FullName $label 'directory' }
  } catch { }
}
$programs = Join-Path $env:LOCALAPPDATA 'Programs'
Get-ChildItem -LiteralPath $programs -Directory -ErrorAction SilentlyContinue | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Select-Object -First 160 | ForEach-Object {
  Scan-Directory $_.FullName $_.Name
  Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Select-Object -First 12 | ForEach-Object { Scan-Directory $_.FullName $_.Parent.Name }
}
$registryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion', 'HKLM:\Software\Microsoft\Windows\CurrentVersion', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion')
foreach ($root in $registryRoots) {
  Get-ChildItem -LiteralPath "$root\App Paths" -ErrorAction SilentlyContinue | Select-Object -First 250 | ForEach-Object {
    Add-Candidate $_.GetValue('') $_.PSChildName 'app-path'
  }
  Get-ChildItem -LiteralPath "$root\Uninstall" -ErrorAction SilentlyContinue | Select-Object -First 400 | ForEach-Object {
    $entry = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
    if ($entry.DisplayName -and -not $entry.SystemComponent -and -not $entry.ParentKeyName) {
      Add-Candidate $entry.DisplayIcon $entry.DisplayName 'registered'
      Scan-Directory $entry.InstallLocation $entry.DisplayName
    }
  }
}
ConvertTo-Json -InputObject @{ candidates=@($items.ToArray()); complete=(-not $script:truncated); error=$(if ($script:truncated) { 'Installed application discovery budget exceeded' } else { $null }) } -Depth 4 -Compress
