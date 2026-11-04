param(
    [ValidateSet('all', 'checks', 'package')]
    [string] $Mode = 'all'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$target = 'x86_64-pc-windows-msvc'
foreach ($name in 'CANDIDATE_SHA', 'PACKAGE_VERSION', 'RELEASE_TAG', 'UPSTREAM_TAG') {
    if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing $name" }
}
Set-Location $repoRoot
$actualSha = git rev-parse HEAD
if ($LASTEXITCODE -or $actualSha -ne $env:CANDIDATE_SHA) { throw 'Build checkout does not match the candidate commit' }

Push-Location codex-rs
try {
    & (Join-Path $PSScriptRoot 'refresh-workspace-lock.ps1')
    if ($Mode -ne 'package') {
        $checks = @(
            @('codex-config', 'tui_user_message'),
            @('codex-tui', 'history_cell::session'),
            @('codex-tui', 'configured_user_message_text_style'),
            @('codex-tui', 'prompt_style_tests'),
            @('codex-tui', 'local_load_preserves_defaults'),
            @('codex-tui', 'transparent_'),
            @('codex-tui', 'bottom_pane::selection_tabs::tests'),
            @('codex-tui', 'config_panel::tests'),
            @('codex-tui', 'transcript_view::follow_control::tests'),
            @('codex-tui', 'bottom_pane::chat_composer::sparkle::tests')
        )
        foreach ($check in $checks) {
            & cargo test --locked --profile ci-test --target $target -p $check[0] --lib $check[1] 2>&1 |
                Tee-Object -Variable log | ForEach-Object { Write-Host $_ }
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) { throw "Tests failed: $($check -join ' ')" }
            if (($log -join "`n") -notmatch 'test result: ok\. [1-9][0-9]* passed') {
                throw "Required custom UI tests were not found: $($check -join ' ')"
            }
        }
        $schemaPath = Join-Path $env:RUNNER_TEMP 'custom-ui-config.schema.json'
        & cargo run --locked --profile ci-test --target $target -p codex-config-schema --bin codex-write-config-schema -- --out $schemaPath
        if ($LASTEXITCODE) { throw 'Config schema generation failed' }
        $expected = (Get-Content core/config.schema.json -Raw).Replace("`r`n", "`n")
        $generated = (Get-Content $schemaPath -Raw).Replace("`r`n", "`n")
        if ($expected -cne $generated) { throw 'Config schema is out of date' }
    }
} finally {
    Pop-Location
}

if ($Mode -eq 'checks') { return }

$packageDir = Join-Path $repoRoot 'out/windows-package'
$releaseDir = Join-Path $repoRoot 'out/release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
& python scripts/build_codex_package.py --target $target --variant codex --cargo-profile release --package-version $env:PACKAGE_VERSION --package-dir $packageDir --strip none
if ($LASTEXITCODE) { throw 'Windows package build failed' }
Copy-Item -LiteralPath docs/header-examples -Destination (Join-Path $packageDir 'headers') -Recurse
Copy-Item -LiteralPath docs/custom-headers.md -Destination (Join-Path $packageDir 'CUSTOM-HEADERS.md')
Copy-Item -LiteralPath docs/custom-ui-updates.md -Destination (Join-Path $packageDir 'UPDATES.md')
Copy-Item -LiteralPath docs/transparent-ui.md -Destination (Join-Path $packageDir 'APPEARANCE.md')
Copy-Item -LiteralPath codex-rs/Cargo.lock -Destination (Join-Path $packageDir 'Cargo.lock')
@'
Codex Custom UI for Windows x86_64

Extract the entire ZIP, then run bin\codex.exe. Keep codex-resources and
codex-path beside bin; they contain required helpers.

Your settings remain in %USERPROFILE%\.codex\config.toml.
For a ready-made header, copy headers into %USERPROFILE%\.codex\headers and add:

[tui.header]
file = "headers/codex-cool.ansi"

See CUSTOM-HEADERS.md for header options, APPEARANCE.md for the transparent UI,
and UPDATES.md for updates.
'@ | Set-Content -LiteralPath (Join-Path $packageDir 'README.txt') -Encoding utf8
$executable = Join-Path $packageDir 'bin/codex.exe'
& $executable --version
if ($LASTEXITCODE) { throw 'Packaged executable smoke test failed' }
$zipName = 'codex-custom-ui-windows-x86_64.zip'
$zipPath = Join-Path $releaseDir $zipName
Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $zipPath -Force
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $zipName" | Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Encoding ascii
@{
    candidate_sha = $env:CANDIDATE_SHA
    package_version = $env:PACKAGE_VERSION
    release_tag = $env:RELEASE_TAG
    upstream_tag = $env:UPSTREAM_TAG
    cargo_lock_sha256 = (Get-FileHash -LiteralPath codex-rs/Cargo.lock -Algorithm SHA256).Hash.ToLowerInvariant()
    target = $target
    built_at = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $releaseDir 'build-metadata.json') -Encoding utf8NoBOM
