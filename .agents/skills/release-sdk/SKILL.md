---
name: release-sdk
description: Prepare or publish a patch release of @macro-inc/sdk in this repository. Use when asked to bump the SDK patch version or release it to npm.
---

# Release the SDK

Read [the SDK release guide](../../../packages/sdk/RELEASING.md) and the root
`AGENTS.md`. Follow the guide for commands, npm setup, validation, tagging, and
recovery; inspect the current workflow and package metadata before executing it.

## Scope

- “Bump” or “prepare a release” authorizes preparation, validation, and a release
  PR as appropriate; it does not by itself authorize publishing to npm.
- “Release/publish a new patch” authorizes the full process, including the release
  PR, merging once required checks/reviews permit it, and pushing the release tag.
  Honor existing session authorization without asking for it again. If release
  authorization is missing, finish the reviewable preparation before asking.
- Creating or editing this skill or its documentation does not authorize a release.

## Execution

1. Inspect the worktree, current branch, `origin/main`, npm versions, release tags,
   and any existing release PR/run. Preserve unrelated changes. Determine the
   next stable patch from current state; resume an already prepared bump instead
   of bumping twice. If versions disagree or the base is a prerelease, resolve
   that before selecting a target.
2. Check the guide's npm prerequisites. Make the version change, run its SDK
   validation and package inspection, and prepare a PR with the old/new version
   and results. Do not hide failed checks or bypass repository review rules.
3. For an authorized publication, merge after required checks/reviews pass and
   pin the actual merged commit. Verify its version, workflow, and ancestry on
   freshly fetched `origin/main`; check npm and remote tags again for collisions.
4. Push only the matching `sdk-vX.Y.Z` tag. Watch the exact tag/commit's Publish SDK
   run, then verify that version and the npm dist-tag. A version bump, a pushed
   tag, or a green validation job alone is not proof of publication.
5. Follow the guide's bounded recovery steps for failures. Never move an existing
   release tag or retry publishing an already published version. If access,
   required reviews, or npm setup block progress, report the completed preparation
   and precise remaining action.

Return the old/new version, PR and release commit, tag, Actions run URL, and npm
verification. Clearly distinguish prepared, awaiting merge, publishing, failed,
and published states; include only artifacts that actually exist.
