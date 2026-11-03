import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function stableVersion(tag) {
  const match = /^rust-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match || match[0] !== tag)
    throw new Error(`Expected a stable Codex CLI tag, got ${tag}`);
  return match[1];
}

export function releaseIdentity(version, sha) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("Invalid package version or commit SHA");
  }
  return {
    release_tag: `custom-ui-v${version}-${sha.slice(0, 12)}`,
    package_version: `${version}-custom.${sha.slice(0, 12)}`,
  };
}

export function git(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure)
    throw new Error(`git ${args[0]} failed: ${result.stderr || result.stdout}`);
  return {
    code: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

// Keep this fork's Actions definitions. GITHUB_TOKEN cannot push upstream workflow changes.
export function mergeUpstream(base, upstream, cwd) {
  const run = (args, opts = {}) => git(args, { cwd, ...opts });
  const merge = run(["merge", "--no-ff", "--no-commit", upstream], {
    allowFailure: true,
  });
  if (!existsSync(resolve(cwd, ".git/MERGE_HEAD"))) {
    throw new Error(
      `Upstream merge did not start: ${merge.stderr || merge.stdout}`,
    );
  }
  run([
    "restore",
    "--source",
    base,
    "--staged",
    "--worktree",
    "--",
    ".github/workflows",
  ]);
  const conflicts = run(["diff", "--name-only", "--diff-filter=U"]).stdout;
  if (conflicts || merge.code > 1) {
    run(["merge", "--abort"]);
    throw new Error(
      `Upstream update needs manual conflict resolution:\n${conflicts || merge.stderr}`,
    );
  }
  run([
    "commit",
    "--allow-empty",
    "-m",
    `Merge upstream Codex ${upstream}; preserve fork workflows`,
  ]);
  return run(["rev-parse", "HEAD"]).stdout;
}

function summary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}\n`;
    if (/[\r\n]/.test(String(value))) throw new Error(`Invalid output ${key}`);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, line);
  }
}

async function api(path, { method = "GET", body, missing = false } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${process.env.GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (missing && response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `GitHub ${method} ${path}: ${response.status} ${await response.text()}`,
    );
  return response.status === 204 ? null : response.json();
}

const repo = () => process.env.GITHUB_REPOSITORY;
const branch = "custom-ui";
const statusContext = "custom-ui/windows";
const runUrl = () =>
  `https://github.com/${repo()}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const getRef = (name) => api(`/repos/${repo()}/git/ref/heads/${name}`);
const getRelease = (tag) =>
  api(`/repos/${repo()}/releases/tags/${tag}`, { missing: true });

async function status(sha, state, description) {
  await api(`/repos/${repo()}/statuses/${sha}`, {
    method: "POST",
    body: { state, context: statusContext, description, target_url: runUrl() },
  });
}

export async function prepare() {
  if (repo() !== "maxximben/codex")
    throw new Error("This automation is configured for maxximben/codex");
  const settings = await api(`/repos/${repo()}`);
  if (settings.default_branch !== branch)
    throw new Error(
      "Set custom-ui as the default branch to activate daily maintenance; see docs/custom-ui-updates.md",
    );
  const upstream = await api("/repos/openai/codex/releases/latest");
  const version = stableVersion(upstream.tag_name);
  const base = (await getRef(branch)).object.sha;
  git(["config", "user.name", "github-actions[bot]"]);
  git([
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  git([
    "fetch",
    "--no-tags",
    "https://github.com/openai/codex.git",
    `refs/tags/${upstream.tag_name}:refs/custom-ui-upstream/current`,
  ]);
  const upstreamSha = git([
    "rev-parse",
    "refs/custom-ui-upstream/current^{commit}",
  ]).stdout;
  const alreadyIncluded = git(
    ["merge-base", "--is-ancestor", upstreamSha, base],
    { allowFailure: true },
  );
  if (alreadyIncluded.code > 1) throw new Error(alreadyIncluded.stderr);
  let candidate = base;
  let prNumber = "";
  if (alreadyIncluded.code !== 0) {
    const candidateBranch = `automation/codex-${version}-${base.slice(0, 12)}`;
    const existing = await api(
      `/repos/${repo()}/git/ref/heads/${candidateBranch}`,
      { missing: true },
    );
    if (existing) {
      git(["fetch", "--no-tags", "origin", `refs/heads/${candidateBranch}`]);
      candidate = existing.object.sha;
      for (const ancestor of [base, upstreamSha])
        git(["merge-base", "--is-ancestor", ancestor, candidate]);
      git(["diff", "--exit-code", base, candidate, "--", ".github/workflows"]);
    } else {
      git(["switch", "--create", candidateBranch, base]);
      candidate = mergeUpstream(base, upstreamSha, process.cwd());
      git(["push", "origin", `HEAD:refs/heads/${candidateBranch}`]);
    }
    const prs = await api(
      `/repos/${repo()}/pulls?state=open&base=${branch}&head=${repo().split("/")[0]}:${candidateBranch}`,
    );
    let pr = prs[0];
    if (!pr)
      pr = await api(`/repos/${repo()}/pulls`, {
        method: "POST",
        body: {
          title: `Update custom-ui to Codex ${version}`,
          base: branch,
          head: candidateBranch,
          body: `Updates from [${upstream.tag_name}](${upstream.html_url}).\n\nThe daily maintenance workflow tests custom headers, transparent backgrounds and sent-message styling, verifies the config schema and builds the Windows package before fast-forwarding custom-ui to this exact commit.\n\nFork-owned .github/workflows files are preserved. Other source conflicts require manual resolution.\n\n[Build and update run](${runUrl()}).`,
        },
      });
    prNumber = pr.number;
    summary(
      `Prepared [PR #${pr.number}](${pr.html_url}) for ${upstream.tag_name}.`,
    );
  } else {
    summary(
      `${upstream.tag_name} is already included in custom-ui (the fork may be ahead of this release).`,
    );
  }
  git(["checkout", "--detach", candidate]);
  const manifest = readFileSync("codex-rs/Cargo.toml", "utf8");
  const packageVersion = /^version\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m.exec(
    manifest,
  )?.[1];
  const identity = releaseIdentity(packageVersion, candidate);
  const published = await getRelease(identity.release_tag);
  const complete =
    published &&
    !published.draft &&
    [
      "codex-custom-ui-windows-x86_64.zip",
      "SHA256SUMS.txt",
      "build-metadata.json",
    ].every((name) => published.assets.some((asset) => asset.name === name));
  const build =
    Boolean(prNumber) || !complete || process.env.FORCE_BUILD === "true";
  output({
    build,
    base_sha: base,
    candidate_sha: candidate,
    pr_number: prNumber,
    upstream_tag: upstream.tag_name,
    upstream_sha: upstreamSha,
    ...identity,
  });
  if (build)
    await status(
      candidate,
      "pending",
      "Testing custom UI and building the Windows package",
    );
  summary(
    build
      ? `Windows validation requested for ${candidate}.`
      : `The Windows release is already published: ${published.html_url}`,
  );
}

export function verifyArtifact(directory, expected) {
  const metadata = JSON.parse(
    readFileSync(resolve(directory, "build-metadata.json"), "utf8"),
  );
  for (const key of [
    "candidate_sha",
    "package_version",
    "release_tag",
    "upstream_tag",
  ]) {
    if (metadata[key] !== expected[key])
      throw new Error(`Artifact metadata mismatch: ${key}`);
  }
  const zip = readFileSync(
    resolve(directory, "codex-custom-ui-windows-x86_64.zip"),
  );
  const hash = createHash("sha256").update(zip).digest("hex");
  if (
    readFileSync(resolve(directory, "SHA256SUMS.txt"), "utf8").trim() !==
    `${hash}  codex-custom-ui-windows-x86_64.zip`
  )
    throw new Error("Artifact SHA256 mismatch");
  return metadata;
}

export async function finalize() {
  const expected = {
    candidate_sha: process.env.CANDIDATE_SHA,
    package_version: process.env.PACKAGE_VERSION,
    release_tag: process.env.RELEASE_TAG,
    upstream_tag: process.env.UPSTREAM_TAG,
  };
  const candidate = expected.candidate_sha;
  if (process.env.BUILD_RESULT !== "success") {
    await status(
      candidate,
      "failure",
      "Windows validation failed; custom-ui was not updated",
    );
    throw new Error("Windows validation failed; inspect the build job logs");
  }
  verifyArtifact("out/release", expected);
  const prNumber = process.env.PR_NUMBER;
  const current = (await getRef(branch)).object.sha;
  if (current !== process.env.BASE_SHA && current !== candidate)
    throw new Error(
      "custom-ui changed during the build; rerun maintenance to test the new base",
    );
  if (prNumber) {
    const pr = await api(`/repos/${repo()}/pulls/${prNumber}`);
    if (
      pr.head.sha !== candidate ||
      pr.base.ref !== branch ||
      (pr.state !== "open" && !pr.merged)
    )
      throw new Error("The update PR changed during the build");
  }
  await status(
    candidate,
    "success",
    "Custom UI tests, schema and Windows package passed",
  );
  if (current !== candidate) {
    // The tested commit already merges upstream and our base. Never synthesize an untested merge.
    await api(`/repos/${repo()}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: { sha: candidate, force: false },
    });
    summary(`Updated custom-ui to tested commit ${candidate}.`);
  }
  let release = await getRelease(expected.release_tag);
  if (!release)
    release = await api(`/repos/${repo()}/releases`, {
      method: "POST",
      body: {
        tag_name: expected.release_tag,
        target_commitish: candidate,
        name: `Codex Custom UI ${expected.package_version}`,
        draft: true,
        prerelease: false,
        body: `Windows x86_64 build of the custom-ui fork.\n\nSource: ${candidate}\nLatest stable upstream checked: ${expected.upstream_tag}\n\nIncludes custom headers, ANSI examples, transparent input/user backgrounds and sent-message styling. Extract the entire ZIP and run bin/codex.exe. Keep the accompanying directories.\n\nValidation: [workflow run](${runUrl()}). Checksums: SHA256SUMS.txt.\n\nThe archive updates the app when you install it; your local installation is not replaced automatically.`,
      },
    });
  for (const name of [
    "codex-custom-ui-windows-x86_64.zip",
    "SHA256SUMS.txt",
    "build-metadata.json",
  ]) {
    if (release.assets.some((asset) => asset.name === name)) continue;
    const upload = new URL(release.upload_url.replace(/\{.*$/, ""));
    if (upload.origin !== "https://uploads.github.com")
      throw new Error("Unexpected release upload host");
    upload.searchParams.set("name", name);
    const response = await fetch(upload, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GH_TOKEN}`,
        "Content-Type": name.endsWith(".zip")
          ? "application/zip"
          : "application/octet-stream",
      },
      body: readFileSync(resolve("out/release", name)),
    });
    if (!response.ok)
      throw new Error(
        `Release asset upload ${name}: ${response.status} ${await response.text()}`,
      );
  }
  if (release.draft)
    release = await api(`/repos/${repo()}/releases/${release.id}`, {
      method: "PATCH",
      body: { draft: false, make_latest: "true" },
    });
  summary(`Published [Windows release](${release.html_url}).`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv[2] === "prepare") await prepare();
    else if (process.argv[2] === "finalize") await finalize();
    else throw new Error("Usage: custom-ui-automation.mjs prepare|finalize");
  } catch (error) {
    summary(`Maintenance stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
