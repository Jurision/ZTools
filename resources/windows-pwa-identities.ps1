$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

<#
Parse only recognized browser launch options; unfamiliar semantics must not merge applications.
@param value Manifest launch parameters, never executed or returned.
@returns Parsed options, or null for ambiguous/unsupported input.
#>
function Read-PwaArguments([string]$value) {
    $result = @{}
    $pattern = '(?:^|\s)--(?<key>[a-z-]+)(?:=(?:"(?<quoted>[^"]*)"|(?<plain>[^\s"]+)))?(?=\s|$)'
    $optionMatches = [regex]::Matches($value, $pattern)
    if ([regex]::Replace($value, $pattern, '').Trim()) { return $null }
    foreach ($match in $optionMatches) {
        $key = $match.Groups['key'].Value
        if ($key -notin @('app-id','ip-edge-aumid','profile-directory','user-data-dir','app-fallback-url','display-mode','windows-store-app')) { return $null }
        if ($result.ContainsKey($key)) { return $null }
        $result[$key] = if ($match.Groups['quoted'].Success) { $match.Groups['quoted'].Value } else { $match.Groups['plain'].Value }
    }
    if (!$result['app-id'] -or !$result['ip-edge-aumid']) { return $null }
    return $result
}

$entries = @(ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()))
$output = [Collections.Generic.List[object]]::new()
$sha = [Security.Cryptography.SHA256]::Create()
try {
    foreach ($entry in ($entries | Select-Object -First 1500)) {
        try {
            if (!$entry.appId -or !$entry.installLocation -or $entry.installLocation -notmatch '^[a-zA-Z]:[\\/]') { continue }
            $manifest = Join-Path $entry.installLocation 'AppxManifest.xml'
            if (!(Test-Path -LiteralPath $manifest) -or (Get-Item -LiteralPath $manifest).Length -gt 524288) { continue }
            # Never resolve DTDs/external entities or read browser profile contents.
            $settings = [Xml.XmlReaderSettings]::new()
            $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
            $settings.XmlResolver = $null
            $reader = [Xml.XmlReader]::Create($manifest, $settings)
            try { $xml = [Xml.XmlDocument]::new(); $xml.XmlResolver = $null; $xml.Load($reader) }
            finally { $reader.Dispose() }
            $id = ([string]$entry.appId).Split('!')[-1]
            $applications = @($xml.SelectNodes('//*[local-name()="Applications"]/*[local-name()="Application"]') | Where-Object { $_.GetAttribute('Id') -ceq $id })
            if ($applications.Count -ne 1) { continue }
            $application = $applications[0]
            $ns = 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10'
            if ($application.GetAttribute('HostId', $ns) -ne 'PWA') { continue }
            $launchOptions = Read-PwaArguments $application.GetAttribute('Parameters', $ns)
            if (!$launchOptions) { continue }
            $extensions = @($application.SelectNodes('.//*[local-name()="AppExtension"]') | Where-Object { $_.GetAttribute('Name') -match '^com\.ms\.webapp\.internals\.\d+$' })
            if ($extensions.Count -ne 1) { continue }
            $fields = @{}
            foreach ($part in $extensions[0].GetAttribute('Description').Split(';')) {
                $pair = $part -split '\?', 2
                if ($pair.Count -ne 2 -or $fields.ContainsKey($pair[0])) { throw 'Ambiguous manifest fields' }
                $fields[$pair[0]] = $pair[1]
            }
            $extensionArgs = Read-PwaArguments $fields['parameters']
            if (!$extensionArgs -or !$fields['profile-directory']) { continue }
            foreach ($key in @('app-id','ip-edge-aumid','user-data-dir')) {
                if ([string]$launchOptions[$key] -cne [string]$extensionArgs[$key]) { throw 'Conflicting launch metadata' }
            }
            $profile = $fields['profile-directory']
            foreach ($options in @($launchOptions,$extensionArgs)) {
                if ($options.ContainsKey('profile-directory') -and $options['profile-directory'] -cne $profile) { throw 'Conflicting profile metadata' }
            }
            $hostId = ([string]$launchOptions['ip-edge-aumid']).ToLowerInvariant()
            $userData = ([string]$launchOptions['user-data-dir']).Replace('/', '\').TrimEnd('\').ToLowerInvariant()
            $identity = ConvertTo-Json -InputObject @($hostId, $launchOptions['app-id'], $profile, $userData) -Compress
            $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-','').ToLowerInvariant()
            $output.Add(@{ appId=[string]$entry.appId; identity=$digest; store=$launchOptions.ContainsKey('windows-store-app'); browserHost=$hostId; browserProfile=$profile })
        } catch {
            # Unknown/unreadable registrations keep their independent activation IDs.
        }
    }
    ConvertTo-Json -InputObject @($output.ToArray()) -Compress
} finally { $sha.Dispose() }

