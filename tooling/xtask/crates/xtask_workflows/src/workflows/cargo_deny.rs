//! `cargo deny check` — advisories/licenses/bans over the cloud-storage
//! workspace on PRs that touch manifests. Generated into `cargo_deny.yml`
//! (replaces the hand-written `cargo-deny.yml`).
//!
//! Advisories come from the RustSec database at the commit in
//! [`ADVISORY_DB_REV`], never the live one, so a newly published advisory
//! can't fail every PR at once. [`super::advisory_db_bump`] moves the pin in a
//! PR of its own, which is the one a new advisory fails.

use gh_workflow::{Event, Job, Run, Step, Use, Workflow, WorkflowCall};
use xtask_paths::{RepoFile, RepoGlob};

use crate::workflows::runners;

/// The RustSec advisory-db commit cargo-deny reads.
pub const ADVISORY_DB_REV: RepoFile<'static> = xtask_paths::repo_file!(".github/advisory-db-rev");

/// Where cargo-deny opens the default database: `db-path` in `deny.toml`, then
/// a directory cargo-deny names after a hash of the database URL. If a newer
/// cargo-deny names it differently, `--disable-fetch` finds no database and
/// the check fails, never passes.
const ADVISORY_DB_DIR: &str = "target/advisory-dbs/advisory-db-3157b0e258782691";

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("crates/**/Cargo.toml"),
    xtask_paths::repo_glob!("services/**/Cargo.toml"),
    xtask_paths::repo_glob!("tooling/xtask/**/Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("deny.toml"),
    RepoGlob::new(ADVISORY_DB_REV.as_str()),
    xtask_paths::repo_glob!(".github/workflows/cargo_deny.yml"),
];

/// Build the workflow.
pub fn cargo_deny() -> Workflow {
    Workflow::new("cargo deny check")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("cargo-deny", cargo_deny_job())
}

/// The deny action ships its own musl cargo-deny binary — no toolchain, no
/// cache volume needed. Small suffices.
fn cargo_deny_job() -> Job {
    Job::default()
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.to_string())
        .add_step(checkout())
        .add_step(fetch_advisory_db())
        .add_step(deny("--disable-fetch"))
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses(
        "actions",
        "checkout",
        "df4cb1c069e1874edd31b4311f1884172cec0e10",
    ) // v6
}

/// Clone the pinned commit where cargo-deny looks for the database. The action
/// runs in a container that sees only the workspace, so it goes there.
///
/// A later `cargo deny check` without `--disable-fetch` runs `git fetch` here,
/// then resets to the first ref in `FETCH_HEAD`. On this detached clone that
/// is `main` only because `origin` tracks nothing else; with every branch, it
/// would be whichever advisory-db branch sorts first. Without a remote, the
/// fetch would fail and cargo-deny, which ignores that, would stay on the pin.
pub(crate) fn fetch_advisory_db() -> Step<Run> {
    Step::new("Fetch the pinned advisory database")
        .run(format!(
            indoc::indoc! {r#"
                set -euo pipefail
                db={db}
                rm -rf "$db"
                git init -q "$db"
                git -C "$db" remote add -t main origin https://github.com/rustsec/advisory-db
                git -C "$db" fetch -q --depth 1 origin "$(cat {rev})"
                git -C "$db" checkout -q --detach FETCH_HEAD
                echo "advisory-db at $(git -C "$db" log -1 --format='%h %cI')"
            "#},
            db = ADVISORY_DB_DIR,
            rev = ADVISORY_DB_REV.as_str(),
        ))
        .shell("bash")
}

/// `cargo deny check` with the given check arguments, reading the database
/// [`fetch_advisory_db`] cloned.
pub(crate) fn deny(check_arguments: &str) -> Step<Use> {
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
        .add_with(("command-arguments", check_arguments))
}
