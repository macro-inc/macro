$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Installs the built installer the way a user's machine would run it, checks
# what it registered, launches Macro and checks the page loaded in WebView2,
# then uninstalls. INSTALLER is the installer's path; EXPECT_SIGNED=true also
# requires a valid Authenticode signature on it and on what it installs.

$installer = $env:INSTALLER
if (-not (Test-Path $installer)) { throw "No installer at $installer" }

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
if ($command -notmatch '^"([^"]+\.exe)"') { throw "Unexpected macro:// command: $command" }
$app = $Matches[1]
$installDir = Split-Path $app
Write-Output "Installed $app"
foreach ($file in @($app, (Join-Path $installDir 'macrod.exe'))) {
  if (-not (Test-Path $file)) { throw "Missing installed file $file" }
  if ($expectSigned) { Assert-Signed $file }
}

# WebView2 reads extra Chromium switches from the environment, so the page can
# be inspected over the DevTools protocol like any Chromium.
$port = 9222
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
$process = Start-Process -FilePath $app -PassThru
try {
  $page = $null
  $deadline = (Get-Date).AddSeconds(120)
  while (-not $page -and (Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) before its page loaded" }
    Start-Sleep -Seconds 2
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
      $page = $targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'https://tauri.localhost/*' } | Select-Object -First 1
    } catch {
      # DevTools is not listening until WebView2 has started.
    }
  }
  if (-not $page) { throw 'No Macro page at https://tauri.localhost within 120 seconds' }

  # Wait for the app to render text: an origin the protocol handler rejects,
  # or a bundle that fails to start, leaves the document empty.
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $expression = 'JSON.stringify({ href: location.href, state: document.readyState, text: (document.body ? document.body.innerText : "").trim().length })'
  $result = $null
  $id = 0
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) while its page loaded" }
    $id++
    $request = @{ id = $id; method = 'Runtime.evaluate'; params = @{ expression = $expression; returnByValue = $true } } | ConvertTo-Json -Compress -Depth 4
    $bytes = [Text.Encoding]::UTF8.GetBytes($request)
    $socket.SendAsync([ArraySegment[byte]]::new($bytes), 'Text', $true, [Threading.CancellationToken]::None).Wait()
    $reply = $null
    while (-not $reply) {
      $message = [IO.MemoryStream]::new()
      do {
        $buffer = [byte[]]::new(65536)
        $receive = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None)
        $receive.Wait()
        $message.Write($buffer, 0, $receive.Result.Count)
      } while (-not $receive.Result.EndOfMessage)
      $frame = [Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json
      # Skip events; only our reply carries our id.
      if ($frame.PSObject.Properties['id'] -and $frame.id -eq $id) { $reply = $frame }
    }
    # An error reply (the page navigating or reloading mid-evaluation) has no
    # value; try again.
    if ($reply.PSObject.Properties['result'] -and $reply.result.result.PSObject.Properties['value']) {
      $result = $reply.result.result.value | ConvertFrom-Json
      if ($result.state -eq 'complete' -and $result.text -gt 0) { break }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $result -or $result.text -eq 0) { throw "Macro's page rendered nothing: $($result | ConvertTo-Json -Compress)" }
  if ($result.href -notlike 'https://tauri.localhost/*') { throw "Macro's page left the app origin: $($result.href)" }
  Write-Output "Page loaded: $($result | ConvertTo-Json -Compress)"
  $socket.Dispose()

  Start-Sleep -Seconds 5
  if ($process.HasExited) { throw "Macro exited with $($process.ExitCode) after loading" }
} finally {
  Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
}

# The uninstaller copies itself elsewhere and returns at once, so wait for its work.
Start-Process -FilePath (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -Wait
$deadline = (Get-Date).AddSeconds(60)
while (((Test-Path $app) -or (Test-Path $commandKey)) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
if (Test-Path $app) { throw "Uninstall left $app" }
if (Test-Path $commandKey) { throw 'Uninstall left the macro:// scheme registered' }
Write-Output 'Uninstalled'
