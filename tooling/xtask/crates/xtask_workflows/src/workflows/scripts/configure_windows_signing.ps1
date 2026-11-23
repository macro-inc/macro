$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Prepares Authenticode signing through Azure Artifact Signing (formerly
# Trusted Signing) and decides whether this build may be published.
#
# Signing happens inside `cargo tauri build`: the bundler runs
# `bundle.windows.signCommand` on Macro.exe, the macrod sidecar, the
# uninstaller and the installer. The command is sign_windows_file.ps1, which
# runs SignTool with Microsoft's signing dlib. The dlib signs in as the
# workload identity this job's GitHub OIDC token stands for, so CI holds no
# signing secret, only the non-secret ids in repository variables.
#
# The dlib and SignTool are found on every build, so a pull request build
# proves they still are; signing (and its .NET check) is configured only on a
# release tag with every variable set.
# Outputs: signed (the installer will be signed) and publish (it may reach the
# release, the update feed and the download pages).

# Microsoft.ArtifactSigning.Client 1.0.146 is the last release on .NET 8, which
# rolls forward to newer runtimes; 1.0.147 and later need .NET 10.
$dlibVersion = '1.0.146'
$dlibSha256 = '7761E5D8F31E54B764DA21D33CD8B0A2940E1B05526C7DFCB5E94B0431426F70'

$tools = Join-Path $env:RUNNER_TEMP 'windows-signing'
Remove-Item -Recurse -Force $tools -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tools | Out-Null
$package = Join-Path $tools 'dlib.zip'
Invoke-WebRequest -MaximumRetryCount 3 -OutFile $package `
  -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/$dlibVersion/microsoft.artifactsigning.client.$dlibVersion.nupkg"
$actual = (Get-FileHash -Algorithm SHA256 $package).Hash
if ($actual -ne $dlibSha256) { throw "Artifact Signing client checksum mismatch: $actual" }
Expand-Archive -Path $package -DestinationPath (Join-Path $tools 'dlib')
$dlib = Join-Path $tools 'dlib\bin\x64\Azure.CodeSigning.Dlib.dll'
if (-not (Test-Path $dlib)) { throw "No x64 dlib in the Artifact Signing client" }

# The newest x64 SignTool of the runner's Windows SDKs.
$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
if (-not $signtool) { throw 'No x64 signtool.exe in the Windows SDK' }

$signed = $false
$publish = $false
$config = Join-Path $env:RUNNER_TEMP 'tauri.signing.json'
'{}' | Set-Content -Path $config

$required = 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'ARTIFACT_SIGNING_ENDPOINT', 'ARTIFACT_SIGNING_ACCOUNT', 'ARTIFACT_SIGNING_PROFILE'
$missing = @($required | Where-Object { -not [Environment]::GetEnvironmentVariable($_) })

if ($env:SIGN -ne 'true') {
  Write-Output 'Not a release tag: the installer stays unsigned.'
} elseif ($missing.Count -gt 0) {
  Write-Output "::warning::Windows signing is not configured (empty: $($missing -join ', ')). The unsigned installer stays a workflow artifact."
} else {
  # The dlib is .NET; without a runtime SignTool fails only once it first signs.
  # Checked only here: unsigned builds never load it.
  $runtimes = if (Get-Command dotnet -ErrorAction SilentlyContinue) { & dotnet --list-runtimes } else { @() }
  if (-not ($runtimes | Where-Object { $_ -match '^Microsoft\.NETCore\.App (\d+)\.' -and [int]$Matches[1] -ge 8 })) {
    throw 'The Artifact Signing dlib needs the .NET 8 (or newer) runtime'
  }
  $metadata = Join-Path $tools 'metadata.json'
  # Only the workload identity may sign: no fallback to whatever else the
  # runner happens to be signed in as.
  @{
    Endpoint               = $env:ARTIFACT_SIGNING_ENDPOINT
    CodeSigningAccountName = $env:ARTIFACT_SIGNING_ACCOUNT
    CertificateProfileName = $env:ARTIFACT_SIGNING_PROFILE
    ExcludeCredentials     = @(
      'EnvironmentCredential', 'ManagedIdentityCredential', 'SharedTokenCacheCredential',
      'VisualStudioCredential', 'VisualStudioCodeCredential', 'AzureCliCredential',
      'AzurePowerShellCredential', 'AzureDeveloperCliCredential', 'InteractiveBrowserCredential'
    )
  } | ConvertTo-Json | Set-Content -Path $metadata
  $script = Join-Path $env:GITHUB_WORKSPACE 'tooling\xtask\crates\xtask_workflows\src\workflows\scripts\sign_windows_file.ps1'
  @{
    bundle = @{
      windows = @{
        signCommand = @{ cmd = 'pwsh'; args = @('-NoProfile', '-NonInteractive', '-File', $script, '%1') }
      }
    }
  } | ConvertTo-Json -Depth 5 | Set-Content -Path $config
  @(
    "SIGNTOOL=$($signtool.FullName)"
    "ARTIFACT_SIGNING_DLIB=$dlib"
    "ARTIFACT_SIGNING_METADATA=$metadata"
    "AZURE_FEDERATED_TOKEN_FILE=$(Join-Path $tools 'oidc-token')"
  ) | Add-Content -Path $env:GITHUB_ENV
  $signed = $true
  if ($env:WINDOWS_DESKTOP_RELEASE -eq 'true') {
    $publish = $true
  } else {
    Write-Output '::notice::Signed, but WINDOWS_DESKTOP_RELEASE is not true: the installer stays a workflow artifact until a person has tested it.'
  }
}

"TAURI_SIGNING_CONFIG=$config" | Add-Content -Path $env:GITHUB_ENV
@(
  "signed=$($signed.ToString().ToLower())"
  "publish=$($publish.ToString().ToLower())"
) | Add-Content -Path $env:GITHUB_OUTPUT
