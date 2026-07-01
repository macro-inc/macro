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

mod assign_author;
mod assign_labels;
mod build_appimage_on_tag;
mod build_desktop_on_tag;
mod build_dmg_on_tag;
mod check_generated;
mod check_node_modules_nix;
mod code_check_cloud_storage;
mod runners;
mod steps;
mod vars;
mod web_app_check_main;

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use gh_workflow::Workflow;

/// A generated workflow. `slug` is the snake_case source module (`<slug>.rs`)
/// used in the generated header. `file_name` is explicit so generated workflows
/// can replace existing hyphenated GitHub workflow filenames without changing
/// their identity in GitHub Actions.
struct WorkflowFile {
    slug: &'static str,
    /// Output filename under `.github/workflows/`.
    file_name: &'static str,
    /// Produces the YAML body for this workflow.
    render_yaml: fn() -> Result<String>,
}

/// Render a `gh_workflow::Workflow` to YAML. Used by most workflow modules.
fn render_gh_workflow(build: fn() -> Workflow) -> impl Fn() -> Result<String> {
    move || build().to_string().map_err(|e| anyhow::anyhow!("{e:?}"))
}

/// Every workflow we generate. Add new workflows here.
const WORKFLOWS: &[WorkflowFile] = &[
    WorkflowFile {
        slug: "assign_author",
        file_name: "assign-author.yml",
        render_yaml: || render_gh_workflow(assign_author::assign_author)(),
    },
    WorkflowFile {
        slug: "assign_labels",
        file_name: "assign-labels.yml",
        render_yaml: || render_gh_workflow(assign_labels::assign_labels)(),
    },
    WorkflowFile {
        slug: "build_appimage_on_tag",
        file_name: "build_appimage_on_tag.yml",
        render_yaml: || render_gh_workflow(build_appimage_on_tag::build_appimage)(),
    },
    WorkflowFile {
        slug: "build_dmg_on_tag",
        file_name: "build_dmg_on_tag.yml",
        render_yaml: || render_gh_workflow(build_dmg_on_tag::build_dmg)(),
    },
    WorkflowFile {
        slug: "build_desktop_on_tag",
        file_name: "build_desktop_on_tag.yml",
        render_yaml: || render_gh_workflow(build_desktop_on_tag::build_desktop_on_tag)(),
    },
    WorkflowFile {
        slug: "code_check_cloud_storage",
        file_name: "code_check_cloud_storage.yml",
        render_yaml: || render_gh_workflow(code_check_cloud_storage::code_check_cloud_storage)(),
    },
    WorkflowFile {
        slug: "check_node_modules_nix",
        file_name: "check_node_modules_nix.yml",
        render_yaml: || render_gh_workflow(check_node_modules_nix::check_node_modules_nix)(),
    },
    WorkflowFile {
        slug: "check_generated",
        file_name: "check_generated.yml",
        render_yaml: || render_gh_workflow(check_generated::check_generated_workflows)(),
    },
    WorkflowFile {
        slug: "web_app_check_main",
        file_name: "web-app-check-main.yml",
        render_yaml: || render_gh_workflow(web_app_check_main::web_app_check_main)(),
    },
];

/// Write every workflow to disk.
pub fn generate() -> Result<()> {
    let dir = workflows_dir()?;
    for workflow in WORKFLOWS {
        let path = dir.join(workflow.file_name);
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
        let path = dir.join(workflow.file_name);
        let on_disk =
            fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        if on_disk != render(workflow)? {
            stale.push(workflow.file_name.to_string());
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
    let yaml =
        (workflow.render_yaml)().with_context(|| format!("serializing {}", workflow.file_name))?;
    Ok(format!("{}{yaml}", disclaimer(workflow.slug)))
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
