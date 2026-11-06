//! `cargo deny check` — advisories/licenses/bans over the cloud-storage
//! workspace on PRs that touch manifests. Generated into `cargo_deny.yml`
//! (replaces the hand-written `cargo-deny.yml`).

use gh_workflow::{Event, Job, PullRequest, PullRequestType, Step, Use, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, vars};

/// Files whose change runs the check, on a push and in `PR CI`.
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
    let pull_request = PullRequest::default()
        .add_branch("main")
        .add_type(PullRequestType::Opened)
        .add_type(PullRequestType::Synchronize)
        .add_type(PullRequestType::Reopened)
        .add_type(PullRequestType::ReadyForReview);

    Workflow::new("cargo deny check")
        .on(Event::default()
            .pull_request(
                PATHS
                    .iter()
                    .fold(pull_request, |trigger, path| trigger.add_path(*path)),
            )
            .workflow_call(WorkflowCall::default()))
        .concurrency(vars::concurrency("cargo-deny"))
        .add_job("cargo-deny", cargo_deny_job())
}

/// The deny action ships its own musl cargo-deny binary — no toolchain, no
/// cache volume needed. Small suffices.
fn cargo_deny_job() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_step(checkout())
        .add_step(deny())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses(
        "actions",
        "checkout",
        "df4cb1c069e1874edd31b4311f1884172cec0e10",
    ) // v6
}

fn deny() -> Step<Use> {
    Step::new("cargo deny")
        .uses(
            "EmbarkStudios",
            "cargo-deny-action",
            "bb137d7af7e4fb67e5f82a49c4fce4fad40782fe",
        ) // v2
        .add_with((
            "manifest-path",
            xtask_paths::repo_file!("Cargo.toml").as_str(),
        ))
}
