# Authenticode-signs one file; Tauri's `bundle.windows.signCommand`, set up by
# configure_windows_signing.ps1. Runs once per file the bundler signs.
param([Parameter(Mandatory)][string] $File)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# A fresh GitHub OIDC token for every file: the tokens are short-lived, and
# the bundler signs the last file minutes after the first. The dlib's
# workload identity credential reads it from AZURE_FEDERATED_TOKEN_FILE.
$token = Invoke-RestMethod -MaximumRetryCount 3 `
  -Headers @{ Authorization = "bearer $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN" } `
  -Uri "$env:ACTIONS_ID_TOKEN_REQUEST_URL&audience=api://AzureADTokenExchange"
Set-Content -NoNewline -Path $env:AZURE_FEDERATED_TOKEN_FILE -Value $token.value

& $env:SIGNTOOL sign /v /fd SHA256 /tr 'http://timestamp.acs.microsoft.com' /td SHA256 `
  /d Macro /dlib $env:ARTIFACT_SIGNING_DLIB /dmdf $env:ARTIFACT_SIGNING_METADATA $File
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
