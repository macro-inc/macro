# Releasing the SDK

SDK releases publish `@macro-inc/sdk` to npm. Incrementing `package.json` alone
never publishes: merge the version change into `main`, then push an `sdk-vX.Y.Z`
tag pointing at the intended merged commit. A GitHub Release is optional and is
not the workflow trigger.

Agents can use [`release-sdk`](../../.agents/skills/release-sdk/SKILL.md) to
prepare or publish a patch release using this guide.

## One-time npm setup

Before the first automated release, a package maintainer must verify the package
exists on npm and configure its trusted publisher:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization | `macro-inc` |
| Repository | `macro` |
| Workflow filename | `publish-sdk.yml` |
| Environment | Leave blank; the job declares no environment |
| Allowed actions | Allow direct publishing with `npm publish` |

If the package does not exist, arrange its initial publication with a maintainer
before following the routine patch process. Do not interpret network or
authentication errors as proof that the package or version is available.

Check that `packages/sdk/package.json` has repository metadata matching
`https://github.com/macro-inc/macro` (conventionally
`"repository": { "type": "git", "url": "git+https://github.com/macro-inc/macro.git", "directory": "packages/sdk" }`).
Add missing metadata in the release PR. npm documents this requirement in its
[trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).
The workflow uses OIDC; routine releases do not need an npm token in GitHub secrets.

## Prepare a patch

1. From the repository root, inspect the working tree and fetch current release
   state. Preserve unrelated edits; use a separate checkout if necessary.

   ```sh
   git status --short --branch
   git fetch origin main --tags
   git show origin/main:packages/sdk/package.json
   npm view @macro-inc/sdk versions --json --registry=https://registry.npmjs.org
   git ls-remote --tags origin 'refs/tags/sdk-v*'
   ```

2. Choose the next patch of the current stable version (`X.Y.Z` → `X.Y.(Z+1)`),
   checking both `main` and npm. For example, `0.0.1` → `0.0.2`. If a release
   bump is already prepared, resume it instead of incrementing again. Resolve
   disagreements between the checkout, `main`, tags, and npm before proceeding;
   do not downgrade or silently turn a prerelease/minor/major release into a patch.

3. Edit only the `version` field in `packages/sdk/package.json` for the bump.
   Keep the Bun lockfile consistent if installation changes it; do not introduce
   an npm lockfile or use a version command that creates an early Git tag.

4. In `packages/sdk`, run the same validation as publishing CI:

   ```sh
   bun install --frozen-lockfile
   bun run check && bun test && bun run coverage && bun run build
   npm pack --dry-run --ignore-scripts
   ```

   Inspect the package listing: the compiled JavaScript and declaration files
   referenced by `exports` must be present. `coverage` checks endpoint wrappers,
   not test coverage. SDK CI also checks generated-code freshness; if stale,
   follow the package's `just update-generated` workflow and review its diff.
   Run `just check` from the repository root before committing.

5. Commit the intended release changes, push a branch, and open a PR. Include the
   old/new version, SDK changes being released, and validation results. Wait for
   required checks and reviews, then merge within the user's authorized scope.
   A request to prepare a bump ends at the prepared change or PR; a request to
   publish includes proceeding through the tag and verification steps.

## Publish the merged commit

Use the actual merge or squash commit from the release PR, not an unmerged branch
commit or an unchecked moving `main` tip. From the repository root, set these
values for the release (replace the examples):

```sh
sdk_version='0.0.2'
sdk_release_sha='<full merged commit SHA>'
sdk_tag="sdk-v${sdk_version}"
git fetch origin main --tags
git merge-base --is-ancestor "$sdk_release_sha" origin/main
git show "${sdk_release_sha}:packages/sdk/package.json"
```

Continue only if the ancestry check succeeds, that commit's package version
exactly matches `sdk_version`, and it contains `.github/workflows/publish-sdk.yml`.
Recheck npm and remote tags immediately before tagging. If the version is already
published, verify the existing release instead. If the tag exists, inspect its
commit and associated run; never move, delete, or force-push a release tag.

Pushing this tag starts the public npm publication:

```sh
git tag "$sdk_tag" "$sdk_release_sha"
git push origin "refs/tags/${sdk_tag}"
```

The workflow rejects mismatched versions and commits outside `main`, installs
with Bun, validates, builds, and runs `npm publish --access public`. It has no
manual dispatch trigger and does not create a GitHub Release or release notes.

## Verify and recover

Find the run for the exact tag and confirm its commit SHA before watching it:

```sh
gh run list --repo macro-inc/macro --workflow publish-sdk.yml --branch "$sdk_tag" \
  --json databaseId,headSha,status,conclusion,url
# Replace RUN_ID with the matching run's databaseId.
gh run watch RUN_ID --repo macro-inc/macro --exit-status
npm view "@macro-inc/sdk@${sdk_version}" version dist.tarball --json \
  --registry=https://registry.npmjs.org
npm view @macro-inc/sdk dist-tags --json --registry=https://registry.npmjs.org
```

Confirm the requested version is available and `latest` points to it (unless a
newer release has since completed). Report the version, commit, tag, PR, Actions
run URL, and npm verification. If the run has not appeared or npm has not updated,
allow a short bounded wait and report pending status rather than claiming success.

On failure, read the failed job logs and check npm before retrying: a run may have
published successfully before a later failure. Retry the same run only after a
transient or configuration problem is resolved and the version remains
unpublished. Code fixes go through a new PR and a new version/tag. Never overwrite
an existing npm version, move a release tag, or bypass CI with a local publish as
a recovery shortcut. Report missing npm access or setup as a concrete blocker.

## Maintaining the workflow

[Publish SDK](../../.github/workflows/publish-sdk.yml) is generated from
[`publish_sdk.rs`](../../tooling/xtask/crates/xtask_workflows/src/workflows/publish_sdk.rs).
Change the Rust source and regenerate with `cargo x workflows` from the repository
root; do not hand-edit the generated YAML.
