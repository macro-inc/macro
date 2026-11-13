//! `cargo deny check` — advisories/licenses/bans over the cloud-storage
//! workspace on PRs that touch manifests. Generated into `cargo_deny.yml`
//! (replaces the hand-written `cargo-deny.yml`).
//!
//! Advisories come from the live RustSec database, so one published against a
//! package already in `Cargo.lock` would fail every PR that touches Cargo
//! files until `main` changes. A PR therefore fails only on advisories against
//! packages it adds to `Cargo.lock` (`scripts/cargo_deny_new_advisories.ts`);
//! [`super::cargo_deny_advisories`] fails on the rest, daily on `main`.

use gh_workflow::{Event, Job, Run, Step, Use, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

/// The cargo-deny release both workflows run, and the SHA-256 of its
/// `x86_64-unknown-linux-musl` archive.
const CARGO_DENY_VERSION: &str = "0.19.8";
const CARGO_DENY_SHA256: &str = "70e769ae3872e34d45132b17040859175e11401dc12dddb0303e0b8c7d088f3f";

/// cargo-deny's arguments before `check`, in both workflows.
const DENY_ARGS: &str = "--all-features --manifest-path Cargo.toml";

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("crates/**/Cargo.toml"),
    xtask_paths::repo_glob!("services/**/Cargo.toml"),
    xtask_paths::repo_glob!("tooling/xtask/**/Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("deny.toml"),
    xtask_paths::repo_glob!(".github/workflows/cargo_deny.yml"),
];

/// Build the workflow.
pub fn cargo_deny() -> Workflow {
    Workflow::new("cargo deny check")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("cargo-deny", cargo_deny_job())
}

fn cargo_deny_job() -> Job {
    Job::default()
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.to_string())
        // `PR CI` checks out the PR's merge commit, whose first parent is the
        // base: the advisories step reads the base's `Cargo.lock` from it.
        .add_step(checkout().add_with(("fetch-depth", 2)))
        .add_step(steps::setup_rust_light())
        .add_step(install_cargo_deny())
        .add_step(deny("bans licenses sources"))
        .add_step(
            Step::new("cargo deny check advisories, for packages this PR adds")
                .run(steps::node_script(include_str!(
                    "scripts/cargo_deny_new_advisories.ts"
                )))
                .shell("bash")
                .add_env(("DENY_ARGS", DENY_ARGS))
                .add_env(("BASE_REV", "HEAD^1")),
        )
}

pub(crate) fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses(
        "actions",
        "checkout",
        "df4cb1c069e1874edd31b4311f1884172cec0e10",
    ) // v6
}

/// Put the pinned cargo-deny release on `PATH`, after checking its archive.
/// cargo-deny calls `cargo metadata`, so the toolchain comes first.
pub(crate) fn install_cargo_deny() -> Step<Run> {
    Step::new("Install cargo-deny")
        .run(format!(
            indoc::indoc! {r#"
                set -euo pipefail
                name=cargo-deny-{version}-x86_64-unknown-linux-musl
                curl -fsSL -o "$RUNNER_TEMP/$name.tar.gz" \
                  "https://github.com/EmbarkStudios/cargo-deny/releases/download/{version}/$name.tar.gz"
                echo "{sha256}  $RUNNER_TEMP/$name.tar.gz" | sha256sum --check --quiet
                tar -xzf "$RUNNER_TEMP/$name.tar.gz" -C "$RUNNER_TEMP"
                echo "$RUNNER_TEMP/$name" >> "$GITHUB_PATH"
            "#},
            version = CARGO_DENY_VERSION,
            sha256 = CARGO_DENY_SHA256,
        ))
        .shell("bash")
}

/// `cargo deny check` with the given checks.
pub(crate) fn deny(checks: &str) -> Step<Run> {
    Step::new(format!("cargo deny check {checks}"))
        .run(format!("cargo-deny {DENY_ARGS} check {checks}"))
        .shell("bash")
}
