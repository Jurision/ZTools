param([ValidateSet('taskbar','start')][string]$Destination, [switch]$Inspect)
$ErrorActionPreference = 'Stop'
# Resolve the selected launch entry in Explorer so shortcuts retain their arguments and app ID.
$path = $env:ZTOOLS_PIN_ITEM
$shell = New-Object -ComObject Shell.Application
$location = 0
$root = $null
$handle = 0
$desktop = $shell.Windows().FindWindowSW([ref]$location, [ref]$root, 8, [ref]$handle, 1)
$explorer = $desktop.Document.Application
if ($path.StartsWith('uwp:')) {
    $id = $path.Substring(4)
    $item = $explorer.Namespace('shell:AppsFolder').ParseName($id)
    if (!$item -or $item.Path -ne $id) { 'missing'; return }
} else {
    $file = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if (!$file -or $file.PSIsContainer -or $file.Extension -notin '.exe','.lnk','.appref-ms') { 'missing'; return }
    $item = $explorer.Namespace($file.DirectoryName).ParseName($file.Name)
}
if (!$item) { 'missing'; return }

# Match localized Shell labels, never a partial match that could invoke the reverse action.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ShellPinLabels {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr LoadLibraryEx(string name, IntPtr file, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int LoadString(IntPtr module, uint id, StringBuilder text, int size);
}
"@
# Explorer and Windows PowerShell may use different UI languages. Include installed Shell translations.
$system = Join-Path $env:SystemRoot 'System32'
$libraries = @((Join-Path $system 'shell32.dll')) + @(Get-ChildItem -Path "$system\*-*\shell32.dll.mui" -File -ErrorAction SilentlyContinue | ForEach-Object FullName)
$modules = @($libraries | ForEach-Object { [ShellPinLabels]::LoadLibraryEx($_, [IntPtr]::Zero, 2) } | Where-Object { $_ -ne [IntPtr]::Zero })
function Normalize-Label([string]$Text) {
    return ($Text -replace '\(&.\)','' -replace '&','').Trim()
}
function Get-Labels([int[]]$Ids) {
    foreach ($id in $Ids) {
        $text = [Text.StringBuilder]::new(256)
        foreach ($module in $modules) {
          if ([ShellPinLabels]::LoadString($module, $id, $text, $text.Capacity)) {
            Normalize-Label $text.ToString()
          }
        }
    }
}
if ($Destination -eq 'start') {
    $pin = @(Get-Labels @(51606,51201,51395))
    $unpin = @(Get-Labels @(51609,51394,51396))
} else {
    $pin = @(Get-Labels @(5386,37423))
    $unpin = @(Get-Labels @(5387))
}
$match = $null
foreach ($verb in $item.Verbs()) {
    $label = Normalize-Label $verb.Name
    if ($label -in $unpin) { 'already'; return }
    if ($label -in $pin) { $match = $verb }
}
if (!$match) { 'unavailable'; return }
if ($Inspect) { 'available'; return }
$match.DoIt()
'requested'
