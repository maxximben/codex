import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));

function runStage(t, mode, scenario = "success") {
  const root = mkdtempSync(join(tmpdir(), "codex-windows-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts/custom-ui"), { recursive: true });
  mkdirSync(join(root, "codex-rs/core"), { recursive: true });
  mkdirSync(join(root, "temp"));
  for (const file of ["build-windows.ps1", "refresh-workspace-lock.ps1"]) {
    copyFileSync(join(source, file), join(root, "scripts/custom-ui", file));
  }
  writeFileSync(join(root, "codex-rs/Cargo.toml"), "[workspace]\n");
  writeFileSync(
    join(root, "codex-rs/core/config.schema.json"),
    '{"fixture":true}\n',
  );
  writeFileSync(
    join(root, "runner.ps1"),
    `
param([string] $Root, [string] $Mode, [string] $Scenario)
$ErrorActionPreference = 'Stop'
$global:calls = [System.Collections.Generic.List[string]]::new()
$global:scenario = $Scenario
$global:fixtureRoot = $Root
$env:CANDIDATE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$env:PACKAGE_VERSION = '1.0.0-custom.aaaaaaaaaaaa'
$env:RELEASE_TAG = 'custom-ui-v1.0.0-aaaaaaaaaaaa'
$env:UPSTREAM_TAG = 'rust-v1.0.0'
$env:RUNNER_TEMP = Join-Path $Root 'temp'
function git {
    $global:LASTEXITCODE = 0
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
}
function cargo {
    $global:calls.Add('cargo ' + ($args -join ' '))
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'test') {
        if ($global:scenario -eq 'testFailure') {
            $global:LASTEXITCODE = 1
            'test result: FAILED. 0 passed; 1 failed'
        } elseif ($global:scenario -eq 'missingTests') {
            'test result: ok. 0 passed; 0 failed'
        } else {
            'test result: ok. 1 passed; 0 failed'
        }
    } elseif ($args[0] -eq 'run') {
        $index = [Array]::IndexOf([object[]] $args, '--out')
        $schema = [IO.File]::ReadAllText((Join-Path $global:fixtureRoot 'codex-rs/core/config.schema.json'))
        if ($global:scenario -eq 'schemaDrift') { $schema = '{}' }
        [IO.File]::WriteAllText($args[$index + 1], $schema)
    }
}
function python {
    $global:calls.Add('python ' + ($args -join ' '))
    throw 'Package builder reached'
}
$failure = $null
try { & (Join-Path $Root 'scripts/custom-ui/build-windows.ps1') -Mode $Mode }
catch { $failure = $_.Exception.Message }
@{ calls = @($global:calls); error = $failure } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $Root 'result.json') -Encoding utf8NoBOM
`,
  );
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      join(root, "runner.ps1"),
      "-Root",
      root,
      "-Mode",
      mode,
      "-Scenario",
      scenario,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message || `${result.stdout}\n${result.stderr}`,
  );
  return {
    ...JSON.parse(readFileSync(join(root, "result.json"), "utf8")),
    root,
  };
}

test("checks validate all UI groups and the schema without invoking the package build", (t) => {
  const result = runStage(t, "checks");
  assert.equal(result.error, null);
  const tests = result.calls.filter((call) => call.startsWith("cargo test "));
  assert.equal(tests.length, 14);
  assert.ok(tests.every((call) => call.includes("--locked --profile ci-test")));
  assert.equal(
    result.calls.filter((call) => call.startsWith("cargo run ")).length,
    1,
  );
  assert.ok(!result.calls.some((call) => call.startsWith("python ")));
  assert.equal(existsSync(join(result.root, "out/release")), false);
});

for (const [scenario, message] of [
  ["testFailure", /Tests failed/],
  ["missingTests", /tests were not found/],
  ["schemaDrift", /schema is out of date/],
]) {
  test(`checks cannot pass with ${scenario}`, (t) => {
    const result = runStage(t, "checks", scenario);
    assert.match(result.error, message);
    assert.ok(!result.calls.some((call) => call.startsWith("python ")));
  });
}

test("package builds bypass test compilation and call the release package builder", (t) => {
  const result = runStage(t, "package");
  assert.equal(result.error, "Package builder reached");
  assert.ok(
    !result.calls.some(
      (call) => call.startsWith("cargo test ") || call.startsWith("cargo run "),
    ),
  );
  const command = result.calls.find((call) => call.startsWith("python "));
  assert.ok(command.includes("--cargo-profile release"));
});
