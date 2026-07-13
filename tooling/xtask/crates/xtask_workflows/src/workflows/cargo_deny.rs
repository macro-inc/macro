//! `cargo deny check` — advisories/licenses/bans over the cloud-storage
//! workspace on PRs that touch manifests. Generated into `cargo_deny.yml`
//! (replaces the hand-written `cargo-deny.yml`).

use gh_workflow::{
    Concurrency, Event, Expression, Job, PullRequest, PullRequestType, Step, Use, Workflow,
};

use crate::workflows::runners;

/// Build the workflow.
pub fn cargo_deny() -> Workflow {
    Workflow::new("cargo deny check")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::ReadyForReview)
                .add_path(xtask_paths::repo_glob!("Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("crates/**/Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("services/**/Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("tooling/xtask/**/Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("Cargo.lock"))
                .add_path(xtask_paths::repo_glob!("deny.toml"))
                .add_path(xtask_paths::repo_glob!(".github/workflows/cargo_deny.yml")),
        ))
        .concurrency(
            Concurrency::new(Expression::new("cargo-deny-${{ github.ref }}"))
                .cancel_in_progress(true),
        )
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
