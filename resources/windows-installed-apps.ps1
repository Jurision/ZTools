param([switch]$ShortcutMetadataOnly)
$ErrorActionPreference = 'Stop'
# Node writes stdin as UTF-8; the Windows console OEM encoding can corrupt a mixed-path JSON list.
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$script:truncated = $false
$script:metadataTruncated = $false
$timer = [Diagnostics.Stopwatch]::StartNew()
$items = [System.Collections.Generic.List[object]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$shortcutMetadata = [System.Collections.Generic.List[object]]::new()
$registrations = [System.Collections.Generic.List[object]]::new()
$fileMetadata = @{}
<#
Read each executable's product metadata at most once across all discovery sources.
@param target Fixed-drive executable path already validated by the caller.
@returns Version metadata, or null when unreadable.
#>
function Get-ProductMetadata([string]$target) {
  $key = $target.ToLowerInvariant()
  if (-not $fileMetadata.ContainsKey($key)) {
    try { $fileMetadata[$key] = [Diagnostics.FileVersionInfo]::GetVersionInfo($target) }
    catch { $fileMetadata[$key] = $null }
  }
  return $fileMetadata[$key]
}
<#
Resolve a registration's installation root without executing its uninstall command.
@param entry Registry values or a fixture object.
@returns Specific local installation directory, or null for broad/ambiguous roots.
#>
function Get-RegistrationRoot($entry) {
  $locations = [System.Collections.Generic.List[string]]::new()
  if ($entry.InstallLocation) { $locations.Add([string]$entry.InstallLocation) }
  foreach ($value in @($entry.DisplayIcon, $entry.UninstallString)) {
    if (-not $value) { continue }
    $candidate = [Environment]::ExpandEnvironmentVariables([string]$value).Trim()
    if ($candidate -match '^"([^"]+\.(?:exe|ico))"') { $candidate = $Matches[1] }
    elseif ($candidate -match '^([a-zA-Z]:[\\/].*?\.(?:exe|ico))(?:\s|,|$)') { $candidate = $Matches[1] }
    else { continue }
    $locations.Add([IO.Path]::GetDirectoryName($candidate))
  }
  $validRoots = [System.Collections.Generic.List[string]]::new()
  foreach ($location in $locations) {
    $root = [Environment]::ExpandEnvironmentVariables($location.Trim().Trim('"')).Replace('/', '\').TrimEnd('\')
    if ($root -notmatch '^[a-zA-Z]:\\[^\\]+\\' -or $root -match '^[a-zA-Z]:\\Windows(?:\\|$)' -or $root -match '\\AppData\\(?:Local|Roaming)(?:\\Programs)?$') { continue }
    $validRoots.Add($root)
  }
  if (!$validRoots.Count) { return $null }
  # Prefer the explicit location; otherwise a common ancestor covers updater/version subfolders.
  if ($entry.InstallLocation -and $validRoots[0] -eq ([string]$entry.InstallLocation).TrimEnd('\')) { return $validRoots[0] }
  foreach ($root in ($validRoots | Sort-Object Length)) {
    if (@($validRoots | Where-Object { $_ -ine $root -and -not $_.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) }).Count -eq 0) { return $root }
  }
  return $validRoots[0]
}
<#
Read existing launch settings without executing shortcuts or exposing raw arguments.
@param paths Existing shortcut paths from stdin; tests supply only temporary fixtures.
@returns No value; unsupported/unreadable links retain their separate identities.
#>
function Read-ShortcutMetadata([object[]]$paths) {
  if ($paths.Count -gt 1800) { $script:metadataTruncated = $true }
  $metadataTimer = [Diagnostics.Stopwatch]::StartNew()
  $shell = New-Object -ComObject WScript.Shell
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    foreach ($linkEntry in ($paths | Select-Object -First 1800)) {
      $linkPath = if ($linkEntry -is [string]) { $linkEntry } else { $linkEntry.path }
      if ($metadataTimer.ElapsedMilliseconds -ge 5000) { $script:metadataTruncated = $true; break }
      if ($linkPath -isnot [string] -or $linkPath -notmatch '^[a-zA-Z]:[\\/].*\.lnk$') { continue }
      try {
        if (([IO.DriveInfo]::new([IO.Path]::GetPathRoot($linkPath))).DriveType -ne 'Fixed') { continue }
        if (-not [IO.File]::Exists($linkPath)) { continue }
        # LinkFlags offset 0x14 and RunAsUser 0x2000 are specified by MS-SHLLINK.
        $stream = [IO.File]::Open($linkPath, 'Open', 'Read', 'ReadWrite')
        try {
          $header = New-Object byte[] 24
          if ($stream.Read($header, 0, 24) -ne 24 -or [BitConverter]::ToUInt32($header, 0) -ne 76) { continue }
          $flags = [BitConverter]::ToUInt32($header, 20)
        } finally { $stream.Dispose() }
        # Advertised MSI, legacy VM and shim links may carry additional behavior; keep them separate.
        if ($flags -band (0x1000 -bor 0x20000 -bor 0x400)) { continue }
        $link = $shell.CreateShortcut($linkPath)
        $target = [Environment]::ExpandEnvironmentVariables($link.TargetPath)
        # Some ID-list shortcuts have no WScript target; retain the native scanner resolved target.
        if ([string]::IsNullOrWhiteSpace($target) -and $linkEntry -isnot [string]) { $target = [string]$linkEntry.targetPath }
        if ($target -notmatch '^[a-zA-Z]:[\\/].*\.exe$') { continue }
        # Missing fixed-drive targets are stale shortcuts, not a second installed version.
        $targetExists = $null
        if (([IO.DriveInfo]::new([IO.Path]::GetPathRoot($target))).DriveType -eq 'Fixed') { $targetExists = [IO.File]::Exists($target) }
        $productInfo = if ($targetExists) { Get-ProductMetadata $target } else { $null }
        $working = [Environment]::ExpandEnvironmentVariables($link.WorkingDirectory).Replace('/', '\').TrimEnd('\').ToLowerInvariant()
        $targetDirectory = [IO.Path]::GetDirectoryName($target).TrimEnd('\').ToLowerInvariant()
        $runAs = [bool]($flags -band 0x2000)
        $argumentSignature = 'default'
        if (-not [string]::IsNullOrWhiteSpace($link.Arguments)) {
          $argumentSignature = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($link.Arguments.Trim()))).Replace('-', '').ToLowerInvariant()
        }
        $signature = 'default'
        if ($link.Arguments -ne '' -or ($working -ne '' -and $working -ne $targetDirectory) -or $link.WindowStyle -ne 1 -or $runAs) {
          $settings = @([string]$link.Arguments, $working, [int]$link.WindowStyle, $runAs) | ConvertTo-Json -Compress
          $signature = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($settings))).Replace('-', '').ToLowerInvariant()
        }
        $shortcutMetadata.Add([pscustomobject]@{path=$linkPath;targetPath=$target;launchSignature=$signature;argumentSignature=$argumentSignature;runAsAdmin=$runAs;targetExists=$targetExists;productName=[string]$productInfo.ProductName;productVersion=[string]$productInfo.ProductVersion;publisher=[string]$productInfo.CompanyName;description=[string]$productInfo.FileDescription})
      } catch { }
    }
  } finally { $sha.Dispose() }
}
$request = [Console]::In.ReadToEnd()
if (-not [string]::IsNullOrWhiteSpace($request)) {
  try { Read-ShortcutMetadata -paths (ConvertFrom-Json -InputObject $request) } catch { $script:metadataTruncated = $true }
}
if ($ShortcutMetadataOnly) {
  ConvertTo-Json -InputObject @{candidates=@();complete=(-not $script:metadataTruncated);shortcuts=@($shortcutMetadata.ToArray())} -Depth 4 -Compress
  exit 0
}
# Keep metadata work from consuming the installation scan budget (overall caller timeout: 40 s).
$timer.Restart()
# Collect bounded candidates only; metadata inspection never starts an application.
<#
Read executable metadata without running the candidate.
@param candidate Registered executable or icon path.
@param label Product or containing folder label.
@param source Discovery source identity.
@returns No value; appends bounded metadata candidates.
#>
function Add-Candidate([string]$candidate, [string]$label, [string]$source) {
  if ($timer.ElapsedMilliseconds -ge 30000 -or $items.Count -ge 1800) { $script:truncated = $true; return }
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
    $info = Get-ProductMetadata $file.FullName
    $items.Add([pscustomobject]@{path=$file.FullName; label=$label; source=$source; subsystem=$subsystem; productName=$info.ProductName;productVersion=[string]$info.ProductVersion; description=$info.FileDescription; originalFilename=$info.OriginalFilename;publisher=[string]$info.CompanyName})
  } catch { }
}
<#
Inspect a single known installation directory without recursion.
@param directory Existing fixed-drive directory.
@param label Registered product or folder name.
@returns No value; collects bounded executable metadata.
#>
function Scan-Directory([string]$directory, [string]$label) {
  if ($timer.ElapsedMilliseconds -ge 30000) { $script:truncated = $true; return }
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
      $installRoot = Get-RegistrationRoot $entry
      if ($installRoot) { $registrations.Add([pscustomobject]@{id=$_.Name;root=$installRoot;name=[string]$entry.DisplayName;publisher=[string]$entry.Publisher;version=[string]$entry.DisplayVersion}) }
      Add-Candidate $entry.DisplayIcon $entry.DisplayName 'registered'
      Scan-Directory $entry.InstallLocation $entry.DisplayName
    }
  }
}
ConvertTo-Json -InputObject @{ candidates=@($items.ToArray()); shortcuts=@($shortcutMetadata.ToArray()); registrations=@($registrations.ToArray());complete=(-not $script:truncated -and -not $script:metadataTruncated); error=$(if ($script:metadataTruncated) { 'Shortcut identity metadata budget exceeded' } elseif ($script:truncated) { 'Installed application discovery budget exceeded' } else { $null }) } -Depth 4 -Compress
