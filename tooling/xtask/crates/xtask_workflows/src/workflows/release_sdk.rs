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
//! What counts as a releasable version lives in `packages/sdk/scripts/release.ts`
//! so `just bump` and this workflow apply one policy, comparing with `semver`
//! rather than shell.
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
        .add_step(install_dependencies())
        .add_step(resolve_release())
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

/// Decide whether this push is a release. The policy and its semver
/// comparisons live in `packages/sdk/scripts/release.ts`, shared with
/// `just bump` and unit-tested, so this step stays a single call.
fn resolve_release() -> Step<Run> {
    Step::new("Resolve release version")
        .run("bun scripts/resolve-release.ts")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
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
        .run("npm publish --access public --tag \"${{ steps.resolve.outputs.dist_tag }}\"")
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
