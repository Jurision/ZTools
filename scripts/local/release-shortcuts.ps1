<#
Update existing managed shortcuts before the new process scans them, preserving recovery copies.
@param Links Explicit shortcut paths, never a directory traversal.
@param ReleaseExe New executable path.
@param ReleasesRoot Workspace release directory used to recognize managed old targets.
@param OriginalExe Previous official installation path.
@param BackupDirectory Existing activation backup directory.
@returns Paths of the managed shortcuts updated.
@throws File or COM failures; restored shortcuts retain their previous targets.
#>
function Set-ReleaseShortcuts {
    param([string[]]$Links, [string]$ReleaseExe, [string]$ReleasesRoot, [string]$OriginalExe, [string]$BackupDirectory)
    $shell = New-Object -ComObject WScript.Shell
    $managedRoot = [IO.Path]::GetFullPath($ReleasesRoot).TrimEnd('\') + '\'
    $saved = [Collections.Generic.List[object]]::new()
    try {
        foreach ($link in ($Links | Select-Object -Unique)) {
            if (!(Test-Path -LiteralPath $link)) { continue }
            $shortcut = $shell.CreateShortcut($link)
            $target = $shortcut.TargetPath
            if ($target -ine $OriginalExe -and !($target.StartsWith($managedRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($target) -ieq 'ZTools.exe')) { continue }
            $copy = Join-Path $BackupDirectory ('managed-shortcut-' + $saved.Count + '.lnk')
            Copy-Item -LiteralPath $link -Destination $copy -ErrorAction Stop
            $saved.Add(@{path=$link;backup=$copy;target=$target})
            $shortcut.TargetPath = $ReleaseExe
            $shortcut.WorkingDirectory = Split-Path -Parent $ReleaseExe
            $shortcut.IconLocation = $ReleaseExe + ',0'
            $shortcut.Save()
        }
        ConvertTo-Json -InputObject @($saved.ToArray()) -Depth 3 | Set-Content -LiteralPath (Join-Path $BackupDirectory 'managed-shortcuts.json') -Encoding utf8
        return @($saved | ForEach-Object { $_.path })
    } catch {
        foreach ($record in $saved) { Copy-Item -LiteralPath $record.backup -Destination $record.path -Force }
        throw
    }
}
