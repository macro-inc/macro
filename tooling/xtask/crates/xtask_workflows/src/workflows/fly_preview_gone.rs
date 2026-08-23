//! Guard: Fly full-stack preview must stay gone. S3 `deploy_preview` and
//! Pulumi `reusable_preview_service` are a different product.

use std::path::Path;

const FORBIDDEN_PATHS: &[&str] = &[
    "infra/preview",
    "infra/preview/Dockerfile",
    "infra/preview/fly.toml",
    "infra/preview/hot-update.sh",
    "infra/preview/entrypoint.sh",
    "infra/preview/update.Dockerfile",
    "infra/preview/README.md",
    ".github/workflows/preview-fly.yml",
    ".github/workflows/preview-fly-cleanup.yml",
    "tooling/xtask/crates/xtask_workflows/src/workflows/preview_fly.rs",
    "tooling/xtask/crates/xtask_workflows/src/workflows/preview_fly/test.rs",
];

#[test]
fn fly_full_stack_preview_files_are_gone() {
    let root = xtask_paths::repo_root();
    let leftover: Vec<_> = FORBIDDEN_PATHS
        .iter()
        .copied()
        .filter(|rel| root.join(rel).exists())
        .collect();
    assert!(
        leftover.is_empty(),
        "Fly full-stack preview still present: {leftover:?}"
    );
}

#[test]
fn fly_full_stack_preview_is_not_a_generated_workflow() {
    let names: Vec<_> = super::WORKFLOWS.iter().map(|w| w.file_name).collect();
    assert!(
        !names.contains(&"preview-fly.yml"),
        "preview-fly.yml still in WORKFLOWS"
    );
    assert!(
        !names.contains(&"preview-fly-cleanup.yml"),
        "preview-fly-cleanup.yml still in WORKFLOWS"
    );
}

#[test]
fn fly_api_token_is_not_a_workflow_secret() {
    let vars = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/workflows/vars.rs");
    let src = std::fs::read_to_string(&vars).unwrap();
    assert!(
        !src.contains("FLY_API_TOKEN"),
        "FLY_API_TOKEN leftover in vars.rs"
    );
}
