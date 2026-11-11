<#
.SYNOPSIS
把「本地搜索」插件自带的 Everything 复制到 Program Files 并安装为后台服务。

.DESCRIPTION
不下载任何文件：只使用本机已有、带 voidtools 签名的 Everything.exe。
服务以系统权限运行，所以程序必须放在普通程序改不了的 Program Files 里。
脚本需要管理员权限，会自己请求一次（弹出确认窗口，由用户点「是」）。
不改开机自启项，不改防火墙，不启动 Everything 窗口。

.PARAMETER Uninstall
卸载服务并删除 Program Files 里的副本。

.PARAMETER Source
插件自带 Everything.exe 的完整路径。

.PARAMETER LogPath
结果日志的完整路径；提权后的进程把结果写在这里，供未提权的一侧显示。
#>
param(
    [switch]$Uninstall,
    [string]$Source = (Join-Path $env:USERPROFILE '.ztools\plugins\everything\preload\everything\Everything.exe'),
    [string]$LogPath = (Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))) '.local-work\everything-service.log')
)
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:ProgramFiles 'Everything'
$targetExe = Join-Path $target 'Everything.exe'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    # 未提权的一侧只负责请求一次管理员确认，并在结束后显示结果；路径在这里固定，避免提权后换了账号找不到。
    New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force | Out-Null
    Remove-Item $LogPath -ErrorAction SilentlyContinue
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Source', "`"$Source`"", '-LogPath', "`"$LogPath`"")
    if ($Uninstall) { $arguments += '-Uninstall' }
    try {
        Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $arguments -Verb RunAs -Wait -WindowStyle Hidden
    } catch {
        Write-Host '没有得到管理员确认，什么都没有改动。'
        exit 1
    }
    if (Test-Path $LogPath) { Get-Content $LogPath -Encoding utf8 } else { Write-Host '没有生成结果日志，什么都没有改动。' }
    exit 0
}

$log = [Collections.Generic.List[string]]::new()
try {
    if ($Uninstall) {
        # 先卸载服务再删文件，否则正在运行的服务会占住程序文件。
        if (Test-Path $targetExe) {
            Start-Process -FilePath $targetExe -ArgumentList '-uninstall-service' -Wait
            Start-Sleep -Seconds 2
            Remove-Item $target -Recurse -Force
        }
        $log.Add('已卸载 Everything 服务并删除 Program Files 里的副本。')
    } else {
        # 只接受签名有效且签名者是 voidtools 的原版程序，防止把被改过的文件装成系统服务。
        if (-not (Test-Path $Source)) { throw "找不到插件自带的 Everything：$Source" }
        $signature = Get-AuthenticodeSignature $Source
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=voidtools') {
            throw 'Everything.exe 的数字签名无效，已停止。'
        }
        # 重复安装时先停掉旧服务，才能覆盖程序文件。
        $existing = Get-Service -Name 'Everything' -ErrorAction SilentlyContinue
        if ($existing -and $existing.Status -ne 'Stopped') { Stop-Service -Name 'Everything' -Force }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Copy-Item $Source $targetExe -Force
        # app_data=1 让设置和索引存到当前用户的 AppData，Program Files 里的文件保持只读。
        Set-Content -Path (Join-Path $target 'Everything.ini') -Value "[Everything]`r`napp_data=1" -Encoding ascii
        if (-not $existing) { Start-Process -FilePath $targetExe -ArgumentList '-install-service' -Wait }
        Start-Sleep -Seconds 2
        $service = Get-Service -Name 'Everything' -ErrorAction SilentlyContinue
        if (-not $service) { throw '服务没有安装成功。' }
        if ($service.Status -ne 'Running') { Start-Service -Name 'Everything' }
        $service = Get-Service -Name 'Everything'
        $log.Add("Everything 服务状态：$($service.Status)，启动方式：$($service.StartType)")
        $log.Add("程序位置：$targetExe")
        $log.Add('安装完成。')
    }
} catch {
    $log.Add("失败：$($_.Exception.Message)")
}
Set-Content -Path $LogPath -Value $log -Encoding utf8
