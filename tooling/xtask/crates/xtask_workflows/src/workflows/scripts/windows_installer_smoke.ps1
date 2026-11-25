$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Installs the built installer the way a user's machine would run it and
# checks what it registered. With LAUNCH=true it then launches Macro, checks
# that WebView2 starts, and uninstalls. With DEVTOOLS_PORT set (the unsigned
# pull request build, which opens WebView2's DevTools port) it also checks the
# page loaded; without it, a build that may be released, Macro and WebView2
# must stay up for 30 seconds and the port must stay closed. INSTALLER is the
# installer's path, which may be a wildcard matching one file;
# EXPECT_SIGNED=true also requires a valid Authenticode signature on it and on
# what it installs.

$installers = @(Get-Item -Path $env:INSTALLER -ErrorAction SilentlyContinue)
if ($installers.Count -ne 1) { throw "Expected one installer at $env:INSTALLER, found $($installers.Count)" }
$installer = $installers[0].FullName

function Assert-Signed([string] $Path) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne 'Valid') { throw "$Path is not validly signed: $($signature.Status) $($signature.StatusMessage)" }
  Write-Output "Signed by $($signature.SignerCertificate.Subject): $Path"
}

$expectSigned = $env:EXPECT_SIGNED -eq 'true'
if ($expectSigned) { Assert-Signed $installer }

# /S: silent. Per-user, so no elevation; this also installs WebView2 if the
# runner lacks it, through the bootstrapper the installer carries.
$install = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Installer exited with $($install.ExitCode)" }

# The macro:// handler sign-in callbacks return through, written to HKCU.
$commandKey = 'HKCU:\Software\Classes\macro\shell\open\command'
if (-not (Test-Path $commandKey)) { throw 'The installer did not register the macro:// scheme' }
$command = (Get-ItemProperty -Path $commandKey).'(default)'
# The callback URI must reach the app as its argument.
if ($command -notmatch '^"([^"]+\.exe)"\s+"%1"$') { throw "Unexpected macro:// command: $command" }
$app = $Matches[1]
$installDir = Split-Path $app
Write-Output "Installed $app"
foreach ($file in @($app, (Join-Path $installDir 'macrod.exe'))) {
  if (-not (Test-Path $file)) { throw "Missing installed file $file" }
  if ($expectSigned) { Assert-Signed $file }
}

if ($env:LAUNCH -ne 'true') {
  Write-Output 'Installed; the launch check runs on a runner that can start WebView2'
  exit 0
}

# What the runner offers WebView2, so a runtime that cannot start can be told
# apart from a fault in Macro. Never fails the check.
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $installation = Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name InstallationType -ErrorAction SilentlyContinue
  $runtime = foreach ($key in @(
      'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )) {
    if (Test-Path $key) { "$key = $(Get-ItemPropertyValue $key -Name pv -ErrorAction SilentlyContinue)" }
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $elevated = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  Write-Output "Runner: $($os.Caption) $($os.Version) ($installation), session $((Get-Process -Id $PID).SessionId), interactive $([Environment]::UserInteractive), elevated $elevated"
  Write-Output "WebView2 runtime: $(if ($runtime) { $runtime -join '; ' } else { 'not registered' })"
} catch {
  Write-Output "Could not describe the runner: $_"
}

$env:RUST_BACKTRACE = '1'
# The app's log and any panic go to its standard streams; keep them to show
# when the check fails.
$stdout = Join-Path $env:RUNNER_TEMP 'macro-stdout.log'
$stderr = Join-Path $env:RUNNER_TEMP 'macro-stderr.log'
$process = Start-Process -FilePath $app -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$exeName = Split-Path $app -Leaf
try {
  # WebView2's browser process for Macro: the one without a --type= switch.
  $browser = $null
  $deadline = (Get-Date).AddSeconds(120)
  while (-not $browser -and (Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) before WebView2 started" }
    Start-Sleep -Seconds 2
    $browser = Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" |
      Where-Object { $_.CommandLine -like "*--webview-exe-name=$exeName *" -and $_.CommandLine -notmatch '--type=' } |
      Select-Object -First 1
  }
  if (-not $browser) { throw 'WebView2 did not start for Macro within 120 seconds' }
  Write-Output "WebView2 started: $($browser.CommandLine)"

  if (-not $env:DEVTOOLS_PORT) {
    if ($browser.CommandLine -match '--remote-debugging') { throw 'This build opens the WebView2 DevTools port, which only the pull request build may' }
    $until = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $until) {
      Start-Sleep -Seconds 2
      if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) after WebView2 started" }
      if (-not (Get-Process -Id $browser.ProcessId -ErrorAction SilentlyContinue)) { throw 'WebView2 exited while Macro ran' }
    }
    Write-Output 'Macro and WebView2 stayed up for 30 seconds'
  } else {
    $port = [int]$env:DEVTOOLS_PORT
    if ($browser.CommandLine -notmatch "--remote-debugging-port=$port\b") { throw "WebView2 did not get --remote-debugging-port=$port" }
    $page = $null
    $targets = $null
    $devtoolsError = 'never polled'
    $deadline = (Get-Date).AddSeconds(120)
    while (-not $page -and (Get-Date) -lt $deadline) {
      if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) before its page loaded" }
      Start-Sleep -Seconds 2
      try {
        $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
        $devtoolsError = $null
        $page = $targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'https://tauri.localhost/*' } | Select-Object -First 1
      } catch {
        # DevTools is not listening until WebView2 has started.
        $devtoolsError = "$_"
      }
    }
    if (-not $page) {
      $seen = if ($devtoolsError) { "DevTools unreachable: $devtoolsError" } else { "targets: $($targets | Select-Object type, url | ConvertTo-Json -Compress)" }
      throw "No Macro page at https://tauri.localhost within 120 seconds ($seen)"
    }

    # Wait for the app to render text: an origin the protocol handler rejects,
    # or a bundle that fails to start, leaves the document empty. Every socket
    # call shares the deadline, so a page that stops answering fails the check
    # instead of holding the job.
    $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(90))
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    try {
      $expression = 'JSON.stringify({ href: location.href, state: document.readyState, text: (document.body ? document.body.innerText : "").trim().length })'
      $result = $null
      $loaded = $false
      $id = 0
      try {
        $socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $timeout.Token).Wait()
        while (-not $loaded -and -not $timeout.IsCancellationRequested) {
          if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) while its page loaded" }
          $id++
          $request = @{ id = $id; method = 'Runtime.evaluate'; params = @{ expression = $expression; returnByValue = $true } } | ConvertTo-Json -Compress -Depth 4
          $bytes = [Text.Encoding]::UTF8.GetBytes($request)
          $socket.SendAsync([ArraySegment[byte]]::new($bytes), 'Text', $true, $timeout.Token).Wait()
          $reply = $null
          while (-not $reply) {
            $message = [IO.MemoryStream]::new()
            do {
              $buffer = [byte[]]::new(65536)
              $receive = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $timeout.Token)
              $receive.Wait()
              $message.Write($buffer, 0, $receive.Result.Count)
            } while (-not $receive.Result.EndOfMessage)
            $frame = [Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json
            # Skip events; only our reply carries our id.
            if ($frame.PSObject.Properties['id'] -and $frame.id -eq $id) { $reply = $frame }
          }
          # An error reply (the page navigating or reloading mid-evaluation) has
          # no value; try again.
          if ($reply.PSObject.Properties['result'] -and $reply.result.result.PSObject.Properties['value']) {
            $result = $reply.result.result.value | ConvertFrom-Json
            $loaded = $result.state -eq 'complete' -and $result.text -gt 0 -and $result.href -like 'https://tauri.localhost/*'
          }
          if (-not $loaded) { Start-Sleep -Seconds 2 }
        }
      } catch {
        if (-not $timeout.IsCancellationRequested) { throw }
      }
      if (-not $loaded) { throw "Macro's page did not load at https://tauri.localhost within 90 seconds: $($result | ConvertTo-Json -Compress)" }
      Write-Output "Page loaded: $($result | ConvertTo-Json -Compress)"
    } finally {
      $socket.Dispose()
      $timeout.Dispose()
    }

    Start-Sleep -Seconds 5
    if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) after loading" }
  }
} catch {
  # Whether WebView2 started, with which switches, and what it listens on.
  try {
    $browsers = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'")
    Write-Output "--- $($browsers.Count) msedgewebview2 processes"
    foreach ($browser in $browsers | Where-Object { $_.CommandLine -notmatch '--type=' }) {
      Write-Output "browser $($browser.ProcessId): $($browser.CommandLine)"
      Get-NetTCPConnection -State Listen -OwningProcess $browser.ProcessId -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Output "  listening on $($_.LocalAddress):$($_.LocalPort)" }
    }
  } catch {
    Write-Output "Could not list WebView2 processes: $_"
  }
  foreach ($log in @($stdout, $stderr)) {
    if (Test-Path $log) {
      Write-Output "--- $log (last 200 lines)"
      Get-Content -Path $log -Tail 200
    }
  }
  throw
} finally {
  Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\RUST_BACKTRACE
}

# The uninstaller copies itself elsewhere and returns at once, so wait for its work.
Start-Process -FilePath (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -Wait
$deadline = (Get-Date).AddSeconds(60)
while (((Test-Path $app) -or (Test-Path $commandKey)) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
if (Test-Path $app) { throw "Uninstall left $app" }
if (Test-Path $commandKey) { throw 'Uninstall left the macro:// scheme registered' }
Write-Output 'Uninstalled'
