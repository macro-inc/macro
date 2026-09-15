//! `Release SDK` — publishes `@macro-inc/sdk` when a merge to `main` raises the
//! version in `packages/sdk/package.json`. Generated into `release-sdk.yml`.
//!
//! The version bump rides in the PR that changes the SDK, so `main` and npm
//! never disagree and a release needs no second PR or bot commit (the `main`
//! ruleset has no bypass actors, so a workflow cannot push one anyway). npm is
//! the source of truth for "already released": an unchanged version resolves to
//! a no-op, and the `sdk-v*` tag is written *after* a successful publish, which
//! makes the tag a record of what shipped rather than the trigger.
//!
//! [`publish_sdk`](super::publish_sdk) keeps its tag trigger as the manual
//! recovery path. A tag pushed from here uses `GITHUB_TOKEN`, which by design
//! does not start another workflow run, so the two never double-publish.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Run, Step, Use, Workflow,
};

use crate::workflows::steps;

#[cfg(test)]
mod test;

const PACKAGE_NAME: &str = "@macro-inc/sdk";
const REGISTRY: &str = "https://registry.npmjs.org";

/// Build the workflow.
pub fn release_sdk() -> Workflow {
    Workflow::new("Release SDK")
        .on(Event::default().push(
            Push::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("packages/sdk/package.json"))
                .add_path(xtask_paths::repo_glob!(".github/workflows/release-sdk.yml")),
        ))
        .concurrency(
            // Serialize releases: two bumps landing back to back must publish in
            // order, and cancelling a run mid-publish could orphan the tag.
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
        )
        .add_job("release", release())
}

fn release() -> Job {
    Job::default()
        .name("Release @macro-inc/sdk")
        // npm trusted publishing only supports GitHub-hosted runners.
        .runs_on("ubuntu-latest")
        .permissions(
            Permissions::default()
                // `contents: write` pushes the release tag.
                .contents(Level::Write)
                .id_token(Level::Write),
        )
        .add_step(steps::checkout(true, true))
        .add_step(steps::setup_bun().add_with(("bun-version", "1.3.5")))
        .add_step(setup_node())
        .add_step(setup_npm())
        .add_step(resolve_release())
        .add_step(guard(install_dependencies()))
        .add_step(guard(validate()))
        .add_step(guard(publish_package()))
        .add_step(guard(tag_release()))
        .add_step(summarize())
}

/// Every step after the resolver runs only for an actual release.
fn guard(step: Step<Run>) -> Step<Run> {
    step.if_condition(Expression::new("steps.resolve.outputs.release == 'true'"))
}

fn setup_node() -> Step<Use> {
    Step::new("Setup Node")
        .uses("actions", "setup-node", "v4")
        .add_with(("node-version", "24"))
        .add_with(("registry-url", REGISTRY))
}

fn setup_npm() -> Step<Run> {
    Step::new("Setup npm").run("npm install --global 'npm@^11.5.1'")
}

/// Decide whether this push is a release. The manifest version is compared
/// against npm, not against the previous commit: a re-run, a revert, or an
/// unrelated manifest edit then resolves to a no-op instead of a failed publish.
/// A version *below* npm's latest fails loudly rather than silently skipping —
/// it means someone downgraded the manifest by accident.
fn resolve_release() -> Step<Run> {
    Step::new("Resolve release version")
        .run(indoc::indoc! {r#"
            set -euo pipefail

            version="$(node -p "require('./packages/sdk/package.json').version")"
            tag="sdk-v${version}"
            echo "version=${version}" >> "$GITHUB_OUTPUT"
            echo "tag=${tag}" >> "$GITHUB_OUTPUT"

            published="$(npm view "PACKAGE_NAME@${version}" version --registry=REGISTRY 2>/dev/null || true)"
            if [ -n "$published" ]; then
              echo "PACKAGE_NAME@${version} is already published; nothing to release."
              echo "release=false" >> "$GITHUB_OUTPUT"
              exit 0
            fi

            latest="$(npm view PACKAGE_NAME version --registry=REGISTRY 2>/dev/null || true)"
            if [ -n "$latest" ] && ! node -e '
              const [next, current] = process.argv.slice(1);
              const core = (v) => v.split("-")[0].split(".").map(Number);
              const [a, b] = [core(next), core(current)];
              if (a.length !== 3 || a.some(Number.isNaN)) {
                console.error(`unparseable version ${next}`);
                process.exit(1);
              }
              // A prerelease of the current version (0.1.0-rc.1 over 0.1.0) is
              // deliberate, so only a lower release core is rejected.
              for (let i = 0; i < 3; i++) {
                if (a[i] > b[i]) process.exit(0);
                if (a[i] < b[i]) process.exit(1);
              }
              process.exit(0);
            ' "$version" "$latest"; then
              echo "packages/sdk version ${version} is below the published latest ${latest}"
              exit 1
            fi

            if [ -n "$(git ls-remote --tags origin "refs/tags/${tag}")" ]; then
              echo "tag ${tag} already exists but ${version} is unpublished; inspect it before releasing"
              exit 1
            fi

            echo "releasing PACKAGE_NAME@${version}"
            echo "release=true" >> "$GITHUB_OUTPUT"
        "#}
        .replace("PACKAGE_NAME", PACKAGE_NAME)
        .replace("REGISTRY", REGISTRY))
        .id("resolve")
}

fn install_dependencies() -> Step<Run> {
    Step::new("Install dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

fn validate() -> Step<Run> {
    Step::new("Validate SDK")
        .run("bun run check && bun test && bun run coverage && bun run build")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

fn publish_package() -> Step<Run> {
    Step::new("Publish package")
        .run("npm publish --access public")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

/// Tag only once npm has the version, so a `sdk-v*` tag always names a commit
/// that actually shipped. A lightweight tag needs no committer identity.
fn tag_release() -> Step<Run> {
    Step::new("Tag the release").run(indoc::indoc! {r#"
        set -euo pipefail
        git tag "${{ steps.resolve.outputs.tag }}" "$GITHUB_SHA"
        git push origin "refs/tags/${{ steps.resolve.outputs.tag }}"
    "#})
}

fn summarize() -> Step<Run> {
    Step::new("Summarize")
        .run(indoc::indoc! {r#"
            case "${{ steps.resolve.outputs.release }}" in
              true)
                echo "Published PACKAGE_NAME@${{ steps.resolve.outputs.version }} (${{ steps.resolve.outputs.tag }})" >> "$GITHUB_STEP_SUMMARY"
                ;;
              false)
                echo "No SDK release: packages/sdk version ${{ steps.resolve.outputs.version }} is already published." >> "$GITHUB_STEP_SUMMARY"
                ;;
              *)
                echo "SDK release did not resolve; see the failed step above." >> "$GITHUB_STEP_SUMMARY"
                ;;
            esac
        "#}
        .replace("PACKAGE_NAME", PACKAGE_NAME))
        .if_condition(Expression::new("always()"))
}
