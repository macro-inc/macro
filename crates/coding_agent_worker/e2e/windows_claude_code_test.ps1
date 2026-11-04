# Claude Code installed from npm, served by macrod on Windows: `detect-agents`
# offers it, `service --agent claude-code` installs the ACP adapter through
# npm's `.cmd` shim and points it at the binary behind `claude.cmd`, and the
# adapter it configured opens an ACP session, which starts Claude Code itself.
# No sign-in is needed for that, and pairing goes to a closed local port.
#
#   pwsh windows_claude_code_test.ps1 -Releases DIR -Version TAG
param(
    [Parameter(Mandatory)] [string] $Releases,
    [Parameter(Mandatory)] [string] $Version
)
$ErrorActionPreference = 'Stop'
$work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
$npmPrefix = Join-Path $work 'npm'
$workspace = Join-Path $work 'workspace'
$config = Join-Path $work 'macrod.toml'
New-Item -ItemType Directory -Path $npmPrefix, $workspace | Out-Null

function Check($condition, $message) {
    if (-not $condition) { throw "FAIL: $message" }
    Write-Host "ok: $message"
}
# The JSON lines `$process` prints until `$last` matches one or `$seconds`
# pass; then its stdin closes and the whole process tree stops.
function Read-Json-Lines($process, $seconds, $last) {
    $lines = @()
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    try {
        while ([DateTime]::UtcNow -lt $deadline) {
            $read = $process.StandardOutput.ReadLineAsync()
            if (-not $read.Wait($deadline - [DateTime]::UtcNow) -or $null -eq $read.Result) { break }
            $line = $read.Result | ConvertFrom-Json
            $lines += $line
            if (& $last $line) { break }
        }
    }
    finally {
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(10000)) { $process.Kill($true) }
    }
    return $lines
}

try {
    Expand-Archive (Join-Path $Releases "macrod-$Version-windows-x86_64.zip") $work
    $macrod = Join-Path $work 'macrod.exe'

    # A global npm install, laid out as in %APPDATA%\npm: `claude`, `claude.cmd`
    # and `claude.ps1` side by side.
    & npm install --global --prefix $npmPrefix --no-audit --no-fund --loglevel=error '@anthropic-ai/claude-code'
    Check ($LASTEXITCODE -eq 0) 'npm installs Claude Code'
    $env:Path = "$npmPrefix;$env:Path"
    $env:USERPROFILE = $work
    $env:MACROD_NO_UPDATE = '1'

    $detected = (& $macrod detect-agents | ConvertFrom-Json).agents
    Check (@($detected | Where-Object id -eq 'claude-code').Count -eq 1) 'detect-agents offers Claude Code'

    @"
[macro]
api_url = "http://127.0.0.1:9/agent-harness"
storage_url = "http://127.0.0.1:9/dss"

[harness]
command = "hermes"
args = ["acp"]

[workspace]
path = "."
"@ | Set-Content $config
    # The service reports a fatal error as an event and exits once its stdin
    # closes, like it does under the desktop app.
    $service = [Diagnostics.ProcessStartInfo]::new($macrod)
    foreach ($argument in 'service', '--config', $config, '--agent', 'claude-code', '--workspace', $workspace) {
        $service.ArgumentList.Add($argument)
    }
    $service.UseShellExecute = $false
    $service.RedirectStandardInput = $true
    $service.RedirectStandardOutput = $true
    $events = Read-Json-Lines ([Diagnostics.Process]::Start($service)) 300 { param($line) $line.event -eq 'fatal' }
    Check (@($events | Where-Object event -eq 'adapter_installed').Count -eq 1) 'service installs the ACP adapter with npm'
    Check (($events | Where-Object event -eq 'fatal').message -like '*pairing*') 'service then fails only at pairing with the closed port'

    # The harness env is an inline table, and toml_edit writes a path with
    # backslashes as a literal string.
    function Toml-String($key) {
        $found = [regex]::Match((Get-Content $config -Raw), "\b$key = (?:'([^']*)'|`"((?:[^`"\\]|\\.)*)`")")
        if ($found.Groups[1].Success) { return $found.Groups[1].Value }
        return $found.Groups[2].Value -replace '\\\\', '\'
    }
    $adapter = Toml-String 'command'
    $claude = Toml-String 'CLAUDE_CODE_EXECUTABLE'
    Check ($adapter -like '*\node_modules\.bin\claude-agent-acp.cmd' -and (Test-Path $adapter)) "the harness launches the installed adapter ($adapter)"
    Check ($claude -like '*\claude.exe' -and (Test-Path $claude)) "CLAUDE_CODE_EXECUTABLE is the binary behind claude.cmd ($claude)"

    $start = [Diagnostics.ProcessStartInfo]::new($adapter)
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.Environment['CLAUDE_CODE_EXECUTABLE'] = $claude
    $agent = [Diagnostics.Process]::Start($start)
    $agent.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}')
    $cwd = $workspace | ConvertTo-Json
    $agent.StandardInput.WriteLine("{`"jsonrpc`":`"2.0`",`"id`":2,`"method`":`"session/new`",`"params`":{`"cwd`":$cwd,`"mcpServers`":[]}}")
    $answer = Read-Json-Lines $agent 120 { param($line) $line.id -eq 2 } | Where-Object id -eq 2
    Check ($null -ne $answer) 'the adapter answers session/new'
    Check ($null -ne $answer.result.sessionId) "the adapter starts Claude Code for a session ($($answer | ConvertTo-Json -Compress -Depth 6))"
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
