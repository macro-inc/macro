# Install macrod, Macro's agent daemon, on Windows:
#
#   irm https://raw.githubusercontent.com/macro-inc/macro/main/crates/coding_agent_worker/install/install.ps1 | iex
#
# Run it again to update. MACROD_VERSION pins a release tag (v2026.10.18.0);
# MACROD_INSTALL_DIR overrides where the binary goes
# (%LOCALAPPDATA%\Programs\macrod), which is added to the user PATH.

# A script block, so `irm | iex` leaves no variables behind in the caller's
# session and a failure does not close it.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses.
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $repo = 'macro-inc/macro'
    $installDir = if ($env:MACROD_INSTALL_DIR) { $env:MACROD_INSTALL_DIR }
        else { Join-Path $env:LOCALAPPDATA 'Programs\macrod' }
    $version = if ($env:MACROD_VERSION) { $env:MACROD_VERSION } else { 'latest' }

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'macrod install: 64-bit Windows is required'
    }
    # The x86_64 build also runs on Windows on Arm, under emulation.
    if ($version -eq 'latest') {
        $asset = 'macrod-windows-x86_64.zip'
        $url = "https://github.com/$repo/releases/latest/download/$asset"
    } else {
        $asset = "macrod-$version-windows-x86_64.zip"
        $url = "https://github.com/$repo/releases/download/$version/$asset"
    }

    $work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        Write-Host "Downloading $url"
        $archive = Join-Path $work $asset
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
        Invoke-WebRequest -UseBasicParsing -Uri "$url.sha256" -OutFile "$archive.sha256"

        $expected = ((Get-Content "$archive.sha256" -Raw).Trim() -split '\s+')[0]
        $actual = (Get-FileHash $archive -Algorithm SHA256).Hash
        if ($actual -ne $expected) { throw "macrod install: checksum mismatch for $asset" }

        Expand-Archive -Path $archive -DestinationPath $work -Force
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        $target = Join-Path $installDir 'macrod.exe'
        # A running macrod.exe cannot be overwritten, but it can be renamed
        # aside; it keeps running from there until it restarts.
        if (Test-Path $target) {
            Remove-Item "$target.old" -Force -ErrorAction SilentlyContinue
            Move-Item $target "$target.old" -Force
        }
        Copy-Item (Join-Path $work 'macrod.exe') $target

        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (-not (($userPath -split ';') -contains $installDir)) {
            $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            $env:Path = "$env:Path;$installDir"
            Write-Host "Added $installDir to your PATH; open a new terminal to use it there."
        }
        Write-Host "Installed $(& $target --version) to $target"
        Write-Host 'Run: macrod'
    } finally {
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
