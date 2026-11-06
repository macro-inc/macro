# Releasing the SDK

`@macro-inc/sdk` and `@macro-inc/sdk-calls` publish to npm when a merge to `main`
raises their `version`. There is no release PR, no dispatch, and no tag to
push: bump the version in the same PR that changes the SDK, and merging it
releases. If the version is unchanged, the release workflow resolves to a no-op.

[Release SDK](../../.github/workflows/release-sdk.yml) validates both packages,
runs `npm publish`, and only then pushes the `sdk-vX.Y.Z` and `sdk-calls-vX.Y.Z`
tags, so a release tag always names a commit that actually shipped.

Agents can use [`release-sdk`](../../.agents/skills/release-sdk/SKILL.md).

## Versioning `@macro-inc/sdk-calls`

The two packages share one version, and `@macro-inc/sdk-calls` requires
`@macro-inc/sdk@^<that version>`. `just bump` moves all three fields together.
`Release SDK` and `tests/release.test.ts` refuse manifests that disagree.

Why lockstep rather than independent versions:

- **A stale peer range is the failure to prevent.** Before 1.0 a caret range covers
  only one minor, and `@macro-inc/sdk@0.3.0` has no calls API at all. A hand-kept
  range would need updating on every SDK minor, and forgetting it either breaks
  installs or lets them resolve to an SDK without the API.
- **It is a thin layer.** The package's contract is the SDK's `CallConnection`, so a
  release of one that the other didn't move costs nothing but an identical tarball.
- **Which versions work together needs no lookup.** They're the same number.

The cost is that an SDK bump publishes `@macro-inc/sdk-calls` even when it didn't
change. That's accepted. The first release is 0.4.0; `0.0.0-bootstrap.0` is an empty
placeholder that exists only so a trusted publisher could be registered.

## Bump

From `packages/sdk`, on the branch carrying your SDK change:

```sh
just bump          # patch; also accepts minor, major, or an explicit X.Y.Z
```

The script refuses a version npm already has, and touches only the two `version`
fields and the peer range. Commit it with the rest of your change — reviewers should see the API
change and the version it ships in one diff.

Then run the same validation the release workflow runs:

```sh
bun install --frozen-lockfile
bun run check && bun test && bun run coverage && bun run build
npm pack --dry-run --ignore-scripts
```

Then, from `packages/sdk-calls` (it compiles against the SDK's build):

```sh
bun install --frozen-lockfile
bun run check && bun test && bun run build && bun run check:pack
```

`check:pack` fails if the tarball misses a file `exports` names, ships anything
else, or an export won't load in Node.

The compiled JavaScript and declaration files referenced by `exports` must
appear in the package listing. `coverage` checks endpoint wrappers, not test
coverage. `SDK Check` runs the same package suite on the PR and again on the
merge to `main`. Generated-code freshness is checked on the PR by the web app
workflow's `Generated Code Check`; if it reports staleness, run
`just update-generated` and review the diff. Run
`just check` from the repository root before committing.

Forgetting to bump publishes nothing, which is the intended failure mode: open a
follow-up PR with the bump.

## What happens on merge

`Release SDK` runs on any push to `main` touching either package's `package.json`:

1. `bun scripts/resolve-release.ts` checks the two manifests agree, then reads each
   version and asks npm about it. Already published → no-op for that package. Below
   what npm serves → fails, since that is an accidental downgrade. The policy lives
   in [`scripts/release.ts`](scripts/release.ts), shared with `just bump` and
   unit-tested in [`tests/release.test.ts`](tests/release.test.ts); `semver`
   does the comparing.
2. `bun install --frozen-lockfile`, then `check`, `test`, `coverage`, `build` for the
   SDK, and the sdk-calls suite above. Both validate before either publishes.
3. `npm publish --access public` over OIDC trusted publishing, the SDK first because
   sdk-calls requires it. A prerelease version publishes under the `next` dist-tag
   so it never becomes what a plain `npm install` resolves to.
4. Pushes each lightweight tag right after its package publishes.

Each package resolves against npm on its own, so if the SDK published and sdk-calls
failed, re-running the job publishes only what's missing.

Verify:

```sh
gh run list --repo macro-inc/macro --workflow release-sdk.yml --branch main \
  --json databaseId,headSha,status,conclusion,url
npm view "@macro-inc/sdk@<version>" version dist.tarball --json --registry=https://registry.npmjs.org
npm view @macro-inc/sdk dist-tags --json --registry=https://registry.npmjs.org
npm view "@macro-inc/sdk-calls@<version>" version peerDependencies dist.tarball --json --registry=https://registry.npmjs.org
npm view @macro-inc/sdk-calls dist-tags --json --registry=https://registry.npmjs.org
```

A merged bump, a green job, or a pushed tag is not proof of publication; the npm
version is. If the run has not appeared or npm has not updated, allow a short
bounded wait and report pending status rather than claiming success.

## One-time npm setup

Publication uses OIDC trusted publishing, so no npm token lives in GitHub
secrets. A package maintainer must register the publisher once per package, on
npmjs.com (`@macro-inc/sdk` and `@macro-inc/sdk-calls`):

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization | `macro-inc` |
| Repository | `macro` |
| Workflow filename | `release-sdk.yml` |
| Environment | Leave blank; the job declares no environment |
| Allowed actions | Allow direct publishing with `npm publish` |

Register `publish-sdk.yml` as a second trusted publisher to keep the recovery
path below working. Until this is done, every release fails at `npm publish`
with an authentication error — `0.0.1` was published by hand, so OIDC has not
yet been exercised. Do not interpret network or authentication errors as proof
that the package or version is available. npm documents the requirement in its
[trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

A publisher can only be registered on a package that exists, and OIDC can't create
one. A new package name therefore needs one publish by a person with publish rights
on the `@macro-inc` org, from their own machine: an empty placeholder under a
non-`latest` tag, never real code.

```sh
npm publish --access public --tag bootstrap # a folder holding only package.json
```

Then register the publisher, and let `Release SDK` publish the first real version.

`packages/sdk/package.json` must keep repository metadata matching
`https://github.com/macro-inc/macro`.

## Recovery

[Publish SDK](../../.github/workflows/publish-sdk.yml) remains as the manual
path, triggered by pushing an `sdk-v*` or `sdk-calls-v*` tag. Use it when a release
commit is already on `main` but the automatic run failed for a transient reason and
left a version unpublished. Try re-running the failed `Release SDK` job first:

```sh
git fetch origin main --tags
git merge-base --is-ancestor "$release_sha" origin/main
git tag "sdk-v${version}" "$release_sha"       # or "sdk-calls-v${version}"
git push origin "refs/tags/sdk-v${version}"
```

It re-checks that the tag version matches that package's manifest and that the commit
is on `main`. Tags pushed by `Release SDK` use `GITHUB_TOKEN`, which does not start
another workflow run, so the two paths never double-publish.

On failure, read the job logs and check npm before retrying: a run may have
published before a later step failed. Code fixes go through a new PR and a new
version. Never overwrite an existing npm version, move a release tag, or publish
locally as a shortcut. Report missing npm access or setup as a concrete blocker.

## Maintaining the workflows

Both workflows are generated from Rust:
[`release_sdk.rs`](../../tooling/xtask/crates/xtask_workflows/src/workflows/release_sdk.rs)
and
[`publish_sdk.rs`](../../tooling/xtask/crates/xtask_workflows/src/workflows/publish_sdk.rs).
Change the source and regenerate with `cargo x workflows` from the repository
root; do not hand-edit the generated YAML.
