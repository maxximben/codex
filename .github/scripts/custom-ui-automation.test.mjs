import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  git,
  mergeUpstream,
  releaseIdentity,
  stableVersion,
  verifyArtifact,
  finalize,
} from "./custom-ui-automation.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "codex-update-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = (args) => git(args, { cwd: directory }).stdout;
  const write = (name, content) =>
    writeFileSync(join(directory, name), content);
  run(["init", "--initial-branch=main"]);
  run(["config", "user.name", "Update test"]);
  run(["config", "user.email", "test@example.invalid"]);
  run(["config", "core.autocrlf", "false"]);
  mkdirSync(join(directory, ".github/workflows"), { recursive: true });
  write(".github/workflows/upstream.yml", "original workflow\n");
  write("source.txt", "original source\n");
  write("custom.txt", "original customization\n");
  run(["add", "."]);
  run(["commit", "-m", "common ancestor"]);
  const ancestor = run(["rev-parse", "HEAD"]);
  return { directory, run, write, ancestor };
}

test("only stable Codex CLI tags can trigger updates", () => {
  assert.equal(stableVersion("rust-v0.166.0"), "0.166.0");
  for (const invalid of [
    "rust-v0.166.0-alpha.1",
    "rusty-v8-v1.0.0",
    "sdk-v1.0.0",
    "v1.0.0",
    "rust-v1.0.0\nother",
    "rust-v1.0.0\n",
  ]) {
    assert.throws(() => stableVersion(invalid));
  }
});

function finalizeFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "codex-finalize-test-"));
  const oldCwd = process.cwd();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  t.after(() => {
    process.chdir(oldCwd);
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env))
      if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    rmSync(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  Object.assign(process.env, {
    GITHUB_REPOSITORY: "maxximben/codex",
    GITHUB_RUN_ID: "123",
    GH_TOKEN: "test-placeholder",
    CANDIDATE_SHA: "a".repeat(40),
    BASE_SHA: "b".repeat(40),
    PR_NUMBER: "7",
    BUILD_RESULT: "success",
    PACKAGE_VERSION: "1.0.0-custom.aaaaaaaaaaaa",
    RELEASE_TAG: "custom-ui-v1.0.0-aaaaaaaaaaaa",
    UPSTREAM_TAG: "rust-v1.0.0",
  });
  delete process.env.GITHUB_STEP_SUMMARY;
  mkdirSync("out/release", { recursive: true });
  writeFileSync(
    "out/release/build-metadata.json",
    JSON.stringify({
      candidate_sha: process.env.CANDIDATE_SHA,
      package_version: process.env.PACKAGE_VERSION,
      release_tag: process.env.RELEASE_TAG,
      upstream_tag: process.env.UPSTREAM_TAG,
    }),
  );
  const archive = Buffer.from("fixture archive");
  writeFileSync("out/release/codex-custom-ui-windows-x86_64.zip", archive);
  writeFileSync(
    "out/release/SHA256SUMS.txt",
    `${createHash("sha256").update(archive).digest("hex")}  codex-custom-ui-windows-x86_64.zip\n`,
  );
  const requests = [];
  const mock = (handler) => {
    globalThis.fetch = async (url, options = {}) => {
      const request = {
        url: String(url),
        method: options.method || "GET",
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      requests.push(request);
      return Response.json(handler(request));
    };
  };
  return { requests, mock };
}

test("failed Windows validation records failure without updating refs or releases", async (t) => {
  const f = finalizeFixture(t);
  process.env.BUILD_RESULT = "failure";
  f.mock(() => ({}));
  await assert.rejects(finalize(), /Windows validation failed/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.state, "failure");
  assert.match(f.requests[0].url, /\/statuses\//);
});

test("a concurrently changed custom branch cannot be merged or published", async (t) => {
  const f = finalizeFixture(t);
  f.mock(() => ({ object: { sha: "c".repeat(40) } }));
  await assert.rejects(finalize(), /changed during the build/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, "GET");
});

test("successful validation fast-forwards to the tested commit without force or an extra merge", async (t) => {
  const f = finalizeFixture(t);
  f.mock((request) => {
    if (request.url.includes("/git/ref/heads/"))
      return { object: { sha: process.env.BASE_SHA } };
    if (request.url.endsWith("/pulls/7"))
      return {
        head: { sha: process.env.CANDIDATE_SHA },
        base: { ref: "custom-ui" },
        state: "open",
      };
    if (request.url.includes("/releases/tags/"))
      return {
        id: 1,
        draft: false,
        assets: [
          "codex-custom-ui-windows-x86_64.zip",
          "SHA256SUMS.txt",
          "build-metadata.json",
        ].map((name) => ({ name })),
        html_url: "https://github.com/maxximben/codex/releases/example",
      };
    return {};
  });
  await finalize();
  const mutations = f.requests.filter((request) => request.method !== "GET");
  assert.equal(mutations.length, 2);
  assert.equal(mutations[0].body.state, "success");
  assert.deepEqual(mutations[1].body, { sha: "a".repeat(40), force: false });
  assert.equal(mutations[1].method, "PATCH");
  assert.match(mutations[1].url, /\/git\/refs\/heads\/custom-ui$/);
});

test("release identities bind the archive version to an exact source commit", () => {
  assert.deepEqual(releaseIdentity("0.166.0", "a".repeat(40)), {
    release_tag: "custom-ui-v0.166.0-aaaaaaaaaaaa",
    package_version: "0.166.0-custom.aaaaaaaaaaaa",
  });
  assert.throws(() => releaseIdentity("bad", "a".repeat(40)));
  assert.throws(() => releaseIdentity("1.0.0", "main"));
});

test("merge includes upstream source, preserves customizations and freezes all workflow changes", (t) => {
  const f = fixture(t);
  f.run(["switch", "-c", "upstream"]);
  f.write("source.txt", "new upstream source\n");
  f.write(".github/workflows/upstream.yml", "changed upstream workflow\n");
  f.write(".github/workflows/new.yml", "new upstream workflow\n");
  f.run(["add", "."]);
  f.run(["commit", "-m", "new upstream"]);
  const upstream = f.run(["rev-parse", "HEAD"]);
  f.run(["switch", "-c", "custom-ui", f.ancestor]);
  f.write("custom.txt", "custom UI stays\n");
  f.write(".github/workflows/upstream.yml", "fork workflow\n");
  f.write(".github/workflows/custom-ui-update.yml", "daily updater\n");
  f.run(["add", "."]);
  f.run(["commit", "-m", "custom UI"]);
  const base = f.run(["rev-parse", "HEAD"]);
  const candidate = mergeUpstream(base, upstream, f.directory);
  assert.equal(
    f.run(["show", `${candidate}:source.txt`]),
    "new upstream source",
  );
  assert.equal(f.run(["show", `${candidate}:custom.txt`]), "custom UI stays");
  assert.equal(f.run(["diff", base, candidate, "--", ".github/workflows"]), "");
  assert.equal(
    existsSync(join(f.directory, ".github/workflows/new.yml")),
    false,
  );
  f.run(["merge-base", "--is-ancestor", upstream, candidate]);
  f.run(["merge-base", "--is-ancestor", base, candidate]);
  assert.equal(f.run(["status", "--porcelain"]), "");
});

test("a source conflict aborts the merge and leaves the custom branch unchanged", (t) => {
  const f = fixture(t);
  f.run(["switch", "-c", "upstream"]);
  f.write("source.txt", "upstream changed same line\n");
  f.run(["commit", "-am", "upstream"]);
  const upstream = f.run(["rev-parse", "HEAD"]);
  f.run(["switch", "-c", "custom-ui", f.ancestor]);
  f.write("source.txt", "custom UI changed same line\n");
  f.run(["commit", "-am", "custom UI"]);
  const base = f.run(["rev-parse", "HEAD"]);
  assert.throws(
    () => mergeUpstream(base, upstream, f.directory),
    /source\.txt/,
  );
  assert.equal(f.run(["rev-parse", "HEAD"]), base);
  assert.equal(f.run(["status", "--porcelain"]), "");
});

test("workflow-only upstream updates still record ancestry without altering fork workflows", (t) => {
  const f = fixture(t);
  f.run(["switch", "-c", "upstream"]);
  f.run(["rm", ".github/workflows/upstream.yml"]);
  f.run(["commit", "-m", "remove upstream workflow"]);
  const upstream = f.run(["rev-parse", "HEAD"]);
  f.run(["switch", "-c", "custom-ui", f.ancestor]);
  f.write(".github/workflows/upstream.yml", "fork version\n");
  f.run(["commit", "-am", "fork workflow"]);
  const base = f.run(["rev-parse", "HEAD"]);
  const candidate = mergeUpstream(base, upstream, f.directory);
  assert.equal(f.run(["diff", base, candidate]), "");
  f.run(["merge-base", "--is-ancestor", upstream, candidate]);
});

test("published artifacts must match the tested commit and checksum", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "codex-artifact-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const expected = {
    candidate_sha: "a".repeat(40),
    package_version: "1.0.0-custom.aaaaaaaaaaaa",
    release_tag: "custom-ui-v1.0.0-aaaaaaaaaaaa",
    upstream_tag: "rust-v1.0.0",
  };
  writeFileSync(
    join(directory, "build-metadata.json"),
    JSON.stringify(expected),
  );
  const zip = Buffer.from("example artifact");
  writeFileSync(join(directory, "codex-custom-ui-windows-x86_64.zip"), zip);
  writeFileSync(
    join(directory, "SHA256SUMS.txt"),
    `${createHash("sha256").update(zip).digest("hex")}  codex-custom-ui-windows-x86_64.zip\n`,
  );
  assert.deepEqual(verifyArtifact(directory, expected), expected);
  assert.throws(
    () =>
      verifyArtifact(directory, { ...expected, candidate_sha: "b".repeat(40) }),
    /metadata mismatch/,
  );
  writeFileSync(
    join(directory, "codex-custom-ui-windows-x86_64.zip"),
    "corrupted",
  );
  assert.throws(() => verifyArtifact(directory, expected), /SHA256 mismatch/);
  assert.match(
    readFileSync(join(directory, "build-metadata.json"), "utf8"),
    /upstream_tag/,
  );
});
