param(
    [string] $ManifestPath = 'Cargo.toml',
    [switch] $Offline
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$manifest = (Resolve-Path -LiteralPath $ManifestPath).Path
Push-Location (Split-Path -Parent $manifest)
try {
    # Upstream release tags bump workspace.package.version without refreshing Cargo.lock.
    # Match the official release workflow: keep external dependencies pinned while
    # refreshing workspace package versions before using --locked for validation.
    $cargoArguments = @('update', '--workspace', '--manifest-path', $manifest)
    if ($Offline) { $cargoArguments += '--offline' }
    & cargo @cargoArguments
    if ($LASTEXITCODE) { throw 'Failed to refresh release workspace versions in Cargo.lock' }
} finally {
    Pop-Location
}
