//! `Release SDK` — publishes `@macro-inc/sdk` and `@macro-inc/sdk-calls` when a
//! merge to `main` raises their shared version. Generated into `release-sdk.yml`.
//!
//! Both packages validate before either publishes, and the SDK publishes first,
//! because `@macro-inc/sdk-calls` requires the matching SDK version. Each resolves
//! against npm on its own, so re-running after a partial release publishes only
//! what is missing.
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

use crate::workflows::{sdk_check::CALLS_VALIDATION, steps};

#[cfg(test)]
mod test;

const SDK_RELEASE: &str = "steps.resolve.outputs.release == 'true'";
const CALLS_RELEASE: &str = "steps.resolve.outputs.calls_release == 'true'";
const ANY_RELEASE: &str =
    "steps.resolve.outputs.release == 'true' || steps.resolve.outputs.calls_release == 'true'";
const REGISTRY: &str = "https://registry.npmjs.org";

/// Build the workflow.
pub fn release_sdk() -> Workflow {
    Workflow::new("Release SDK")
        .on(Event::default().push(
            Push::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("packages/sdk/package.json"))
                .add_path(xtask_paths::repo_glob!("packages/sdk-calls/package.json"))
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
        .name("Release @macro-inc/sdk and @macro-inc/sdk-calls")
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
        .add_step(validate().if_condition(Expression::new(ANY_RELEASE)))
        .add_step(install_calls_dependencies().if_condition(Expression::new(ANY_RELEASE)))
        .add_step(validate_calls().if_condition(Expression::new(ANY_RELEASE)))
        .add_step(publish_package().if_condition(Expression::new(SDK_RELEASE)))
        .add_step(tag_release().if_condition(Expression::new(SDK_RELEASE)))
        .add_step(publish_calls().if_condition(Expression::new(CALLS_RELEASE)))
        .add_step(tag_calls_release().if_condition(Expression::new(CALLS_RELEASE)))
        .add_step(summarize())
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

fn install_calls_dependencies() -> Step<Run> {
    Step::new("Install sdk-calls dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
}

fn validate_calls() -> Step<Run> {
    Step::new("Validate sdk-calls")
        .run(CALLS_VALIDATION)
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
}

fn publish_calls() -> Step<Run> {
    Step::new("Publish sdk-calls")
        .run("npm publish --access public --tag \"${{ steps.resolve.outputs.calls_dist_tag }}\"")
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
}

fn tag_calls_release() -> Step<Run> {
    Step::new("Tag the sdk-calls release").run(indoc::indoc! {r#"
        set -euo pipefail
        git tag "${{ steps.resolve.outputs.calls_tag }}" "$GITHUB_SHA"
        git push origin "refs/tags/${{ steps.resolve.outputs.calls_tag }}"
    "#})
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
            summarize() {
              case "$2" in
                true) echo "Published $1@$3 ($4)" >> "$GITHUB_STEP_SUMMARY" ;;
                false) echo "No release of $1: $3 is already published." >> "$GITHUB_STEP_SUMMARY" ;;
                *) echo "$1 did not resolve; see the failed step above." >> "$GITHUB_STEP_SUMMARY" ;;
              esac
            }
            summarize @macro-inc/sdk "${{ steps.resolve.outputs.release }}" "${{ steps.resolve.outputs.version }}" "${{ steps.resolve.outputs.tag }}"
            summarize @macro-inc/sdk-calls "${{ steps.resolve.outputs.calls_release }}" "${{ steps.resolve.outputs.calls_version }}" "${{ steps.resolve.outputs.calls_tag }}"
        "#})
        .if_condition(Expression::new("always()"))
}
