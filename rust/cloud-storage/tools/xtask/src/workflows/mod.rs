//! Generate the repo's GitHub Actions workflows from Rust.
//!
//! `cargo run -p xtask -- workflows` writes every entry in [`WORKFLOWS`] to
//! `<repo-root>/.github/workflows/<filename>`. The `--check` variant regenerates
//! them in memory and fails if the committed YAML has drifted, so CI can
//! guarantee the checked-in YAML always matches this source.
//!
//! Layout mirrors Zed's xtask: one file per workflow plus three shared "library"
//! files — [`runners`] (runner labels), [`vars`] (env / secrets / concurrency),
//! and [`steps`] (reusable step + job helpers).

mod check_generated;
mod code_check_cloud_storage;
mod runners;
mod steps;
mod vars;

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use gh_workflow::Workflow;

/// A generated workflow.
struct WorkflowFile {
    /// File written under `.github/workflows/`. Kept stable so branch
    /// protection's required status checks keep matching.
    filename: &'static str,
    /// Source module (for the "do not edit" header), e.g. `code_check_cloud_storage`.
    source: &'static str,
    /// Builds the workflow definition.
    build: fn() -> Workflow,
}

/// Every workflow we generate. Add new workflows here.
const WORKFLOWS: &[WorkflowFile] = &[
    WorkflowFile {
        filename: "code-check-cloud-storage.yml",
        source: "code_check_cloud_storage",
        build: code_check_cloud_storage::code_check_cloud_storage,
    },
    WorkflowFile {
        filename: "check-generated-workflows.yml",
        source: "check_generated",
        build: check_generated::check_generated_workflows,
    },
];

/// Write every workflow to disk.
pub fn generate() -> Result<()> {
    let dir = workflows_dir()?;
    for workflow in WORKFLOWS {
        let path = dir.join(workflow.filename);
        fs::write(&path, render(workflow)?)
            .with_context(|| format!("writing {}", path.display()))?;
        println!("generated {}", path.display());
    }
    Ok(())
}

/// Fail if any committed workflow differs from what we'd generate now.
pub fn check() -> Result<()> {
    let dir = workflows_dir()?;
    let mut stale = Vec::new();
    for workflow in WORKFLOWS {
        let path = dir.join(workflow.filename);
        let on_disk =
            fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        if on_disk != render(workflow)? {
            stale.push(workflow.filename);
        }
    }
    if !stale.is_empty() {
        bail!(
            "generated workflows are stale: {}\nrun `cargo x workflows` from rust/cloud-storage and commit the result",
            stale.join(", ")
        );
    }
    println!("all generated workflows are up to date");
    Ok(())
}

/// Serialize a workflow to YAML and prepend the "do not edit" header.
fn render(workflow: &WorkflowFile) -> Result<String> {
    let yaml = (workflow.build)()
        .to_string()
        .map_err(|e| anyhow::anyhow!("serializing {}: {e:?}", workflow.filename))?;
    Ok(format!("{}{yaml}", disclaimer(workflow.source)))
}

/// The header every generated file starts with.
fn disclaimer(source: &str) -> String {
    format!(
        "# DO NOT EDIT — regenerate with `cargo x workflows` (from rust/cloud-storage).\n\
         # Source: rust/cloud-storage/tools/xtask/src/workflows/{source}.rs\n",
    )
}

/// `<repo-root>/.github/workflows`, anchored on the crate's manifest dir so the
/// task works from any cwd. This crate lives at
/// `<repo-root>/rust/cloud-storage/tools/xtask`, i.e. four ancestors up.
fn workflows_dir() -> Result<PathBuf> {
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .context("xtask manifest dir has no repo root four levels up")?;
    let dir = repo_root.join(".github").join("workflows");
    if !dir.is_dir() {
        bail!("expected a workflows directory at {}", dir.display());
    }
    Ok(dir)
}
