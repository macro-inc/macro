---
name: release-sdk
description: Bump and release @macro-inc/sdk from this repository. Use when asked to bump the SDK version or release it to npm.
---

# Release the SDK

Read [the SDK release guide](../../../packages/sdk/RELEASING.md) and the root
`AGENTS.md`. Releasing is merging a version bump: `Release SDK` publishes on any
push to `main` that raises the version in `packages/sdk/package.json`. There is
no release tag to push by hand and no separate publish step to trigger.

## Scope

- "Bump" authorizes editing the version and validating it, in the PR that carries
  the SDK change.
- Because merging publishes, authorization to merge a version bump to `main` is
  authorization to publish. Do not merge a bump without it. Honor existing
  session authorization without asking again.
- Creating or editing this skill or its documentation does not authorize a release.

## Execution

1. Inspect the worktree, current branch, `origin/main`, npm versions, and release
   tags. Preserve unrelated changes. If a bump is already prepared on the branch,
   resume it rather than bumping twice; if versions disagree or the base is a
   prerelease, resolve that first.
2. Run `just bump` in `packages/sdk` (it takes `patch`, `minor`, `major`, or an
   explicit version), then the guide's validation and package inspection. Commit
   the bump alongside the SDK change. Do not hide failed checks.
3. After the merge, watch the `Release SDK` run for that commit, then verify the
   npm version and dist-tag. A merged bump, a green job, or a pushed tag alone is
   not proof of publication.
4. Use the guide's recovery path — the `sdk-v*` tag trigger on `Publish SDK` —
   only when a merged release commit failed transiently and the version is still
   unpublished. Never move an existing tag or re-publish a published version.

Return the old/new version, PR and release commit, tag, Actions run URL, and npm
verification. Clearly distinguish prepared, awaiting merge, publishing, failed,
and published states; include only artifacts that actually exist.
