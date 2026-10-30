# The Windows self-update end to end, with a real running macrod: install v1
# with install.ps1 from an HTTP mirror, start the control panel, publish a v2
# whose checksum is wrong and check nothing is installed, then publish v2 and
# check the running v1 downloads, verifies and installs it beside itself
# while it keeps running. Stopping v1 and launching again must run v2 and
# prune v1: on Windows an update is used from the next launch.
#
#   pwsh windows_update_test.ps1 -Releases DIR -V1 TAG -V2 TAG
param(
    [Parameter(Mandatory)] [string] $Releases,
    [Parameter(Mandatory)] [string] $V1,
    [Parameter(Mandatory)] [string] $V2
)
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install\install.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
$mirror = Join-Path $work 'mirror'
$installDir = Join-Path $work 'macrod'
$runDir = Join-Path $work 'run'
$requests = Join-Path $work 'requests.log'
New-Item -ItemType Directory -Path $mirror, $runDir | Out-Null
New-Item -ItemType File -Path $requests | Out-Null

function Check($condition, $message) {
    if (-not $condition) { throw "FAIL: $message" }
    Write-Host "ok: $message"
}
function Archive($tag) { "macrod-$tag-windows-x86_64.zip" }
function Publish($tag, $checksum) {
    $name = Archive $tag
    Copy-Item (Join-Path $Releases $name) $mirror -Force
    $digest = if ($checksum) { $checksum } else { (Get-FileHash (Join-Path $mirror $name)).Hash.ToLower() }
    Set-Content (Join-Path $mirror "$name.sha256") "$digest  $name"
    @{ tag_name = $tag; assets = @() } | ConvertTo-Json | Set-Content (Join-Path $mirror 'latest.json')
    Write-Host "published $tag to the mirror"
}
function Wait-For($description, [scriptblock] $condition, $seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $condition) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "FAIL: timed out waiting for $description"
}
function Requests-For($name) {
    @(Get-Content $requests | Where-Object { $_ -like "*/$name" }).Count
}
# The update log's events in order, timestamps dropped.
function Update-Log {
    Get-Content (Join-Path $env:HOME '.macrod\logs\update.log') | ForEach-Object { $_ | ConvertFrom-Json }
}
# Each expected event appears in this order, with these fields.
function Check-Log-In-Order($expected) {
    $events = @(Update-Log)
    $position = 0
    foreach ($want in $expected) {
        while ($position -lt $events.Count -and
            @($want.Keys | Where-Object { $events[$position].$_ -ne $want[$_] }).Count -gt 0) {
            $position++
        }
        Check ($position -lt $events.Count) "the update log has $($want | ConvertTo-Json -Compress)"
        $position++
    }
}
function Cores {
    @(Get-CimInstance Win32_Process -Filter "Name = 'macrod-core.exe'" |
        Where-Object { $_.ExecutablePath -like "$installDir*" })
}

# The mirror over HTTP, logging every request path, so the log shows what
# the running macrod fetched.
$listener = [Net.HttpListener]::new()
$port = Get-Random -Minimum 20000 -Maximum 40000
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
$server = Start-ThreadJob -ArgumentList $listener, $mirror, $requests -ScriptBlock {
    param($listener, $mirror, $requests)
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $path = $context.Request.Url.AbsolutePath
        Add-Content $requests "$(Get-Date -Format o) GET $path"
        $file = Join-Path $mirror ($path.TrimStart('/'))
        if (Test-Path -LiteralPath $file -PathType Leaf) {
            $bytes = [IO.File]::ReadAllBytes($file)
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $context.Response.StatusCode = 404
        }
        $context.Response.Close()
    }
}
$mirrorUrl = "http://127.0.0.1:$port"

$userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
$processes = @()
try {
    Publish $V1
    $env:MACROD_UPDATE_SOURCE = $mirrorUrl
    $env:MACROD_INSTALL_DIR = $installDir
    & $installer
    $launcher = Join-Path $installDir 'macrod.exe'
    Check ((& $launcher --version) -eq "macrod $V1") "install.ps1 installed $V1 from the HTTP mirror"

    # A paired-looking config against an unreachable deployment: the panel
    # serves nothing, but it runs, and its update check runs.
    @"
[macro]
api_url = "http://127.0.0.1:9"
storage_url = "http://127.0.0.1:9"
web_url = "http://127.0.0.1:9"

[identity]
scope = "private"

[harness]
command = "cmd"

[workspace]
path = "."

[credentials]
harness_id = "00000000-0000-0000-0000-0000004a125a"
token = "mhns_windows_update_test"
scope = "user"
"@ | Set-Content (Join-Path $runDir 'macrod.toml')
    $env:MACROD_UPDATE_CHECK_SECONDS = '2'
    # macrod keeps ~/.macrod (and its update log) under HOME when it is set.
    $env:HOME = Join-Path $work 'home'

    # Its own console, as a user starts it from a terminal. (PowerShell
    # names are case-insensitive: $v1 would overwrite the $V1 tag.)
    $firstLaunch = Start-Process -FilePath $launcher -WorkingDirectory $runDir -PassThru
    $processes += $firstLaunch
    Wait-For "the $V1 core to start" { (Cores).Count -eq 1 } 30
    $v1Core = (Cores)[0]
    Check ($v1Core.ExecutablePath -like "*\versions\$V1\macrod-core.exe") "the launcher started $V1 (pid $($v1Core.ProcessId), $($v1Core.ExecutablePath))"
    Wait-For "$V1 to check the mirror" { (Requests-For 'latest.json') -ge 1 } 30
    Write-Host "running $V1 checked the mirror"

    # A tampered release: fetched, rejected, nothing installed.
    Publish $V2 ('0' * 64)
    Wait-For "$V1 to fetch the tampered $V2" { (Requests-For (Archive $V2)) -ge 1 } 30
    $seen = Requests-For (Archive $V2)
    Wait-For "$V1 to retry the tampered $V2" { (Requests-For (Archive $V2)) -gt $seen } 30
    Check (-not (Test-Path (Join-Path $installDir "versions\$V2"))) "a $V2 with a wrong checksum is not installed"
    Check (-not $firstLaunch.HasExited) "$V1 keeps running after the rejected update"

    # The real release: downloaded, verified, installed beside the running v1.
    Publish $V2
    Wait-For "$V1 to install $V2" { Test-Path (Join-Path $installDir "versions\$V2\macrod-core.exe") } 60
    Check (-not (Test-Path (Join-Path $installDir "versions\$V2.partial"))) "$V2 was committed, not left partial"
    $installedVersion = & (Join-Path $installDir "versions\$V2\macrod-core.exe") --version
    Check ($installedVersion -eq "macrod $V2") "the installed core is $V2 ($installedVersion)"
    Check (-not $firstLaunch.HasExited) "$V1 keeps running after installing $V2"
    $running = Cores
    Check ($running.Count -eq 1 -and $running[0].ProcessId -eq $v1Core.ProcessId) "the session process is still $V1 (pid $($v1Core.ProcessId)) until the next launch"

    Write-Host '--- mirror requests ---'
    Get-Content $requests | ForEach-Object { Write-Host $_ }

    # The next launch runs v2 and prunes v1.
    Stop-Process -Id $v1Core.ProcessId -Force
    Wait-For "$V1 to exit" { $firstLaunch.HasExited } 30
    Check ((& $launcher --version) -eq "macrod $V2") "after the update the launcher runs $V2"
    $secondLaunch = Start-Process -FilePath $launcher -WorkingDirectory $runDir -PassThru
    $processes += $secondLaunch
    Wait-For "the $V2 core to start" { (Cores).Count -eq 1 } 30
    $v2Core = (Cores)[0]
    Check ($v2Core.ExecutablePath -like "*\versions\$V2\macrod-core.exe") "the next launch started $V2 (pid $($v2Core.ProcessId), $($v2Core.ExecutablePath))"
    Wait-For "the launcher to prune $V1" { -not (Test-Path (Join-Path $installDir "versions\$V1")) } 30
    Check $true "the launcher pruned $V1"
    Check-Log-In-Order @(
        @{ event = 'startup'; version = $V1; from_handoff = $false },
        @{ event = 'check'; current = $V1; latest = $V2; outcome = 'newer' },
        @{ event = 'download'; version = $V2; checksum_ok = $false },
        @{ event = 'download'; version = $V2; checksum_ok = $true; result = 'staged' },
        @{ event = 'apply'; from = $V1; to = $V2; method = 'next-launch'; result = 'installed for the next launch' },
        @{ event = 'startup'; version = $V2; from_handoff = $false }
    )
    Write-Host '--- update log ---'
    Get-Content (Join-Path $env:HOME '.macrod\logs\update.log') | ForEach-Object { Write-Host $_ }
    Write-Host "self-update $V1 -> $V2 passed"
} catch {
    Write-Host "error: $_"
    Write-Host $_.ScriptStackTrace
    Write-Host '--- mirror requests ---'
    Get-Content $requests -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    throw
} finally {
    $ids = @($processes | ForEach-Object { $_.Id }) + @(Cores | ForEach-Object { $_.ProcessId })
    foreach ($id in ($ids | Where-Object { $_ })) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
    $listener.Stop()
    Remove-Job $server -Force -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable('Path', $userPathBefore, 'User')
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
