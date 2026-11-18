//! `Build Rust CI Image` — manually builds the `macro-rust-ci-small` custom
//! runner image: system packages, Nix and the materialized dev shell, saved by
//! the job's `snapshot`.
//!
//! The image-generation runner ([`runners::RUST_CI_IMAGE_GENERATION`]) must
//! exist in GitHub before this runs.

use gh_workflow::expr::typed::github;
use gh_workflow::{Event, Job, Snapshot, Step, Workflow, WorkflowDispatch, ZizmorRule};

use crate::workflows::actions::ActionsCheckout;
use crate::workflows::runners;

/// Build the workflow.
pub fn build_rust_ci_image() -> Workflow {
    Workflow::new("Build Rust CI Image")
        .on(Event::default().workflow_dispatch(WorkflowDispatch::default()))
        .add_job("build-rust-ci-image", build())
}

fn build() -> Job {
    Job::default()
        .runs_on(runners::RUST_CI_IMAGE_GENERATION)
        .snapshot(Snapshot::new("macro-rust-ci-small").version("1.*"))
        .add_step(
            ActionsCheckout::new("")
                .step()
                .without_name()
                .zizmor_ignore(
                    ZizmorRule::Artipacked,
                    "snapshots a runner image built from the checkout",
                ),
        )
        .add_step(
            Step::new("Install system packages")
                .run(include_str!("scripts/rust_ci_image_install_packages.sh"))
                .shell("bash"),
        )
        .add_step(
            Step::new("Install Nix")
                .run(include_str!("scripts/rust_ci_image_install_nix.sh"))
                .shell("bash"),
        )
        .add_step(
            Step::new("Materialize dev shell into /nix/store")
                .run(include_str!(
                    "scripts/rust_ci_image_materialize_dev_shell.sh"
                ))
                .shell("bash"),
        )
        .add_step(
            Step::new("Write image markers")
                .run(include_str!("scripts/rust_ci_image_write_markers.sh"))
                .shell("bash")
                .add_env(("BUILD_RUN_ID", github().run_id()))
                .add_env(("BUILD_SHA", github().sha())),
        )
        .add_step(
            Step::new("Verify image contents")
                .run(include_str!("scripts/rust_ci_image_verify.sh"))
                .shell("bash"),
        )
}
