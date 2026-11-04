# Automatic updates for the custom-ui fork

All UI modifications and maintenance automation in
[maxximben/codex](https://github.com/maxximben/codex) live on `custom-ui`. Set this
as the default branch during activation. `main` is kept as the original base;
it is not the branch used for custom builds.

## Activate once

After pushing `custom-ui`, authenticate GitHub CLI for this repository with
**Administration: read and write**, **Actions: read and write**, and the existing
code access. Run from the repository root:

```powershell
.\scripts\custom-ui\enable-updates.ps1
```

The script sets the default branch, enables the workflow and PR creation, disables
inherited OpenAI workflows, then requests the first run. It does not store a token
in the repository or in Actions secrets. Without these permissions GitHub returns
HTTP 403 and activation must be completed by the repository owner.

Alternatively, activate through GitHub's website:

1. [Repository settings](https://github.com/maxximben/codex/settings): change the
   default branch to `custom-ui`.
2. [Actions settings](https://github.com/maxximben/codex/settings/actions): enable
   Actions and **Allow GitHub Actions to create and approve pull requests**. Keep
   the default workflow token permissions read-only; the workflow requests its own
   required permissions per job.
3. [Actions](https://github.com/maxximben/codex/actions): enable workflows if GitHub
   asks for confirmation on this fork. Disable inherited OpenAI workflows, enable
   **Custom UI weekly update**, then select **Run workflow**, branch `custom-ui`.

## Weekly maintenance

[Custom UI weekly update](https://github.com/maxximben/codex/actions/workflows/custom-ui-update.yml)
runs every Monday at **03:17 UTC / 09:17 Asia/Omsk**. GitHub can delay scheduled
runs. A new release is normally picked up within the next weekly check.

The workflow checks the latest stable `rust-vX.Y.Z` release of `openai/codex`.
Prereleases are excluded. When the release commit is not already included in
`custom-ui`, it merges that tag into an `automation/codex-*` branch and opens a PR.
It preserves this fork's `.github/workflows/` directory: upstream workflows need
OpenAI infrastructure, and `GITHUB_TOKEN` cannot push workflow changes.
All other source changes are merged normally.

The same workflow runs two parallel Windows jobs for the same candidate commit.
The `checks` job tests custom headers, transparent backgrounds, sent-message text
styles and config defaults, and verifies the generated config schema. It uses the
unoptimized `ci-test` profile without debug symbols or incremental compilation.
The `package` job independently builds and smoke-tests the complete Windows x86_64
distribution in the optimized `release` profile. Both jobs must pass before the
update is accepted or a release is published. A missing test is a
failure, rather than silently accepting zero tests. Windows builds use a short
Cargo cache path and Git long-path support. Downloaded dependencies are cached
before compilation, so a later build failure does not discard that cache.

Upstream release tags change the workspace version without updating `Cargo.lock`.
Before locked validation the build runs `cargo update --workspace`, matching the
official release workflow. This refreshes workspace package versions while keeping
existing external dependency pins. The archive includes the resolved `Cargo.lock`,
whose SHA256 is recorded in `build-metadata.json`.

After successful checks, the workflow fast-forwards `custom-ui` to the exact
tested commit; the update PR is then merged automatically. It never force-pushes
or generates a different, untested merge commit. The `custom-ui/windows` commit
status links to the validation run. If `custom-ui` or the PR changes during the
build, the update stops and the next run can validate the new base.

Conflicts outside `.github/workflows/`, test failures, missing dependencies or
GitHub permission errors stop the update. Inspect the failed Actions run, resolve
source conflicts manually on `custom-ui`, and run maintenance again.

## Download a build

Successful builds appear in [Releases](https://github.com/maxximben/codex/releases)
as `custom-ui-v<workspace-version>-<commit>`. The workspace version may be `0.0.0`
on upstream development code; the commit and `build-metadata.json` identify the
exact source. A fork already ahead of the latest stable release is not downgraded.
New custom commits are also built on the next check even when upstream has no
new stable release.

Download `codex-custom-ui-windows-x86_64.zip`, extract the entire archive, and run
`bin/codex.exe`. Keep its sibling directories. The archive includes the required
helpers, ripgrep and header examples. `SHA256SUMS.txt` contains the archive hash.
Your local executable is updated when you replace/install the extracted package;
this workflow updates the repository and publishes builds, not local installations.

## Run manually or change the schedule

Open the Actions workflow above, choose **Run workflow**, branch `custom-ui`, and
leave `force_build` off for a normal check. Enable it to retest an already built
commit. Existing published assets are not overwritten. Incomplete draft releases
are resumed on a later successful run.

Edit `schedule.cron` in `.github/workflows/custom-ui-update.yml` to change the UTC
time. The workflow must be present on the default branch for scheduling to work.
GitHub can disable schedules in public repositories after 60 days without activity;
if that happens, enable this workflow again in Actions. Keep Actions enabled and
allow GitHub Actions to create pull requests in the repository Actions settings.
No personal access token or external scheduling service is required.

Activation disables inherited OpenAI workflows. Fork maintenance runs its own tests
in the weekly workflow; it does not rely on PR/push events emitted by
`GITHUB_TOKEN` to launch another workflow.
