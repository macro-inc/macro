//! `cloud storage main check`: the whole Rust suite on `main` after merge.
//!
//! Pull requests test only changed packages and their direct dependents, and
//! they test against the base they were last pushed on, so two green PRs can
//! still break `main` together. This is what catches both.
//!
//! One run at a time. A push waits for the current run instead of cancelling it,
//! because at the usual merge rate a cancelled run would never finish. GitHub
//! keeps only the newest waiting run, which contains every commit it replaces.
//! The path filter keeps a web-only push from replacing a waiting Rust one.

use gh_workflow::{Concurrency, Event, Expression, Job, Push, Workflow};

use crate::workflows::{code_check_cloud_storage, steps::FluentBuilder, vars};

#[cfg(test)]
mod test;

/// Workflow name, also what the failure alert and CI telemetry match on.
pub const NAME: &str = "cloud storage main check";

/// Paths that can change a Rust result, kept equal to the pull request
/// workflow's `should_run` filter by a test.
const RUST_PATHS: &[&str] = &[
    "Cargo.toml",
    "Cargo.lock",
    "Cross.toml",
    "clippy.toml",
    "deny.toml",
    "rust-toolchain.toml",
    ".cargo/**",
    ".config/**",
    ".sqlx/**",
    "crates/**",
    "services/**",
    "tooling/xtask/**",
    "static_assets/**",
    "nix/**",
    "nix-support/node_modules*",
    "flake.nix",
    "flake.lock",
    "bun.lock",
    "packages/sdk/**",
    "packages/sdk-docs/**",
    "packages/code-mode-sdk/**",
    ".github/actions/setup-nix/**",
    ".github/actions/setup-nix-dev-shell/**",
    ".github/actions/teardown-nix/**",
    ".github/actions/setup-sccache/**",
    ".github/services-config.json",
    ".github/workflows/main_rust_check.yml",
];

/// Build the workflow.
pub fn main_rust_check() -> Workflow {
    let push = RUST_PATHS
        .iter()
        .fold(Push::default().add_branch("main"), |push, path| {
            push.add_path(*path)
        });
    Workflow::new(NAME)
        .on(Event::default().push(push))
        .map(vars::with_global_env)
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
        )
        .add_job(
            "check",
            code_check_cloud_storage::check_job(Job::default(), "all"),
        )
        .add_job(
            "test",
            code_check_cloud_storage::test_job(Job::default(), "all"),
        )
}
