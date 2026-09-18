# Releasing the SDK

`@macro-inc/sdk` publishes to npm when a merge to `main` raises the `version` in
`packages/sdk/package.json`. There is no release PR, no dispatch, and no tag to
push: bump the version in the same PR that changes the SDK, and merging it
releases. If the version is unchanged, the release workflow resolves to a no-op.

[Release SDK](../../.github/workflows/release-sdk.yml) validates the package,
runs `npm publish`, and only then pushes the `sdk-vX.Y.Z` tag, so a release tag
always names a commit that actually shipped.

Agents can use [`release-sdk`](../../.agents/skills/release-sdk/SKILL.md).

## Bump

From `packages/sdk`, on the branch carrying your SDK change:

```sh
just bump          # patch; also accepts minor, major, or an explicit X.Y.Z
```

The script refuses a version npm already has, and touches only the `version`
field. Commit it with the rest of your change — reviewers should see the API
change and the version it ships in one diff.

Then run the same validation the release workflow runs:

```sh
bun install --frozen-lockfile
bun run check && bun test && bun run coverage && bun run build
npm pack --dry-run --ignore-scripts
```

The compiled JavaScript and declaration files referenced by `exports` must
appear in the package listing. `coverage` checks endpoint wrappers, not test
coverage. `SDK Check` runs the same package suite on the PR and again on the
merge to `main`, and additionally checks generated-code freshness on the PR; if
it reports staleness, run `just update-generated` and review the diff. Run
`just check` from the repository root before committing.

Forgetting to bump publishes nothing, which is the intended failure mode: open a
follow-up PR with the bump.

## What happens on merge

`Release SDK` runs on any push to `main` touching `packages/sdk/package.json`:

1. `bun scripts/resolve-release.ts` reads the manifest version and asks npm
   about it. Already published → no-op. Below what npm serves → fails, since
   that is an accidental downgrade. The policy lives in
   [`scripts/release.ts`](scripts/release.ts), shared with `just bump` and
   unit-tested in [`tests/release.test.ts`](tests/release.test.ts); `semver`
   does the comparing.
2. `bun install --frozen-lockfile`, then `check`, `test`, `coverage`, `build`.
3. `npm publish --access public` over OIDC trusted publishing. A prerelease
   version publishes under the `next` dist-tag so it never becomes what a plain
   `npm install` resolves to.
4. Pushes the lightweight tag `sdk-vX.Y.Z` at the released commit.

Verify:

```sh
gh run list --repo macro-inc/macro --workflow release-sdk.yml --branch main \
  --json databaseId,headSha,status,conclusion,url
npm view "@macro-inc/sdk@<version>" version dist.tarball --json --registry=https://registry.npmjs.org
npm view @macro-inc/sdk dist-tags --json --registry=https://registry.npmjs.org
```

A merged bump, a green job, or a pushed tag is not proof of publication; the npm
version is. If the run has not appeared or npm has not updated, allow a short
bounded wait and report pending status rather than claiming success.

## One-time npm setup

Publication uses OIDC trusted publishing, so no npm token lives in GitHub
secrets. A package maintainer must register the publisher once, on npmjs.com:

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

`packages/sdk/package.json` must keep repository metadata matching
`https://github.com/macro-inc/macro`.

## Recovery

[Publish SDK](../../.github/workflows/publish-sdk.yml) remains as the manual
path, triggered by pushing an `sdk-v*` tag. Use it when a release commit is
already on `main` but the automatic run failed for a transient reason and left
the version unpublished:

```sh
git fetch origin main --tags
git merge-base --is-ancestor "$sdk_release_sha" origin/main
git tag "sdk-v${sdk_version}" "$sdk_release_sha"
git push origin "refs/tags/sdk-v${sdk_version}"
```

It re-checks that the tag version matches the manifest and that the commit is on
`main`. Tags pushed by `Release SDK` use `GITHUB_TOKEN`, which does not start
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
