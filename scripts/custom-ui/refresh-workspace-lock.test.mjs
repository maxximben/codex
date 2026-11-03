import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const helper = join(
  dirname(fileURLToPath(import.meta.url)),
  "refresh-workspace-lock.ps1",
);

test("release version bumps are refreshed before locked validation, preserving dependency pins", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "codex-workspace-lock-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  function write(name, content) {
    const path = join(directory, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const manifest = (version) =>
    `[workspace]\nmembers = ["cli", "core"]\nexclude = ["dependency"]\nresolver = "2"\n[workspace.package]\nversion = "${version}"\n`;
  write("Cargo.toml", manifest("0.0.0"));
  write(
    "cli/Cargo.toml",
    '[package]\nname = "fixture-cli"\nversion.workspace = true\nedition = "2021"\n[dependencies]\nfixture-core = { path = "../core" }\n',
  );
  write("cli/src/main.rs", "fn main() {}\n");
  write(
    "core/Cargo.toml",
    '[package]\nname = "fixture-core"\nversion.workspace = true\nedition = "2021"\n[dependencies]\nfixture-dependency = { path = "../dependency", version = "1.2.3" }\n',
  );
  write("core/src/lib.rs", "pub fn example() {}\n");
  write(
    "dependency/Cargo.toml",
    '[package]\nname = "fixture-dependency"\nversion = "1.2.3"\nedition = "2021"\n',
  );
  write("dependency/src/lib.rs", "pub fn dependency() {}\n");
  const cargo = (args) =>
    spawnSync("cargo", args, { cwd: directory, encoding: "utf8" });
  const initial = cargo(["generate-lockfile", "--offline"]);
  assert.equal(initial.status, 0, initial.error?.message || initial.stderr);
  write("Cargo.toml", manifest("0.166.0"));
  const stale = cargo([
    "tree",
    "--locked",
    "--offline",
    "--workspace",
    "--depth",
    "0",
  ]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /lock file|lockfile/);
  const refresh = () => {
    const result = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        helper,
        "-ManifestPath",
        join(directory, "Cargo.toml"),
        "-Offline",
      ],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      result.error?.message || `${result.stdout}\n${result.stderr}`,
    );
  };
  refresh();
  const valid = cargo([
    "tree",
    "--locked",
    "--offline",
    "--workspace",
    "--depth",
    "0",
  ]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /fixture-cli v0\.166\.0/);
  assert.match(valid.stdout, /fixture-core v0\.166\.0/);
  const lock = readFileSync(join(directory, "Cargo.lock"), "utf8");
  assert.match(lock, /name = "fixture-dependency"\r?\nversion = "1\.2\.3"/);
  refresh();
  assert.equal(
    readFileSync(join(directory, "Cargo.lock"), "utf8"),
    lock,
    "Refresh must be idempotent",
  );
});
