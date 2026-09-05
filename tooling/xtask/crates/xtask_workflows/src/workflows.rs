//! Generate the repo's GitHub Actions workflows from Rust.
//!
//! `cargo x workflows` writes every entry in [`WORKFLOWS`] to
//! `<repo-root>/.github/workflows/<filename>`. The `--check` variant regenerates
//! them in memory and fails if the committed YAML has drifted, so CI can
//! guarantee the checked-in YAML always matches this source.
//!
//! Layout mirrors Zed's xtask: one file per workflow plus three shared "library"
//! files — [`runners`] (runner labels), [`vars`] (env / secrets / concurrency),
//! and [`steps`] (reusable step + job helpers).

mod assign_author;
mod assign_labels;
mod build_agent_daemon_on_tag;
mod build_appimage_on_tag;
mod build_desktop_on_tag;
mod build_dmg_on_tag;
mod cancel_stuck_cloud_storage_deploys;
mod cargo_deny;
mod cargo_workspace_dependency_check;
mod check_generated;
mod check_node_modules_nix;
mod cla;
mod cleanup_preview;
mod code_check_cloud_storage;
mod code_check_conventions;
mod code_check_infra;
mod deploy_ai_editing_worker;
mod deploy_all_services;
mod deploy_cla_worker;
mod deploy_fusionauth_instance;
mod deploy_on_push;
mod deploy_preview;
mod deploy_sync_service;
mod deploy_web_app;
mod docs_check;
mod ensure_daytona_snapshot;
mod path_validation;
mod pulumi_preview_pr;
mod push_local_stack_binaries;
mod reusable_deploy_service;
mod reusable_preview_service;
mod runners;
mod sdk_check;
mod steps;
mod vars;
mod web_app_check_main;
mod web_artifact_paths;

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
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

/// Render a `gh_workflow::Workflow`, then apply a structural patch to the YAML
/// for constructs gh-workflow 0.8 cannot express: reusable-workflow caller
/// `with:` / `secrets: inherit`, and `workflow_call`/`workflow_dispatch` input
/// blocks (the crate models those as unordered `HashMap`s, which would
/// serialize in nondeterministic order and trip the drift guard).
fn render_patched(
    build: fn() -> Workflow,
    patch: fn(&mut serde_yaml::Value) -> Result<()>,
) -> Result<String> {
    let yaml = render_gh_workflow(build)()?;
    let mut root: serde_yaml::Value =
        serde_yaml::from_str(&yaml).context("re-parsing generated workflow YAML")?;
    patch(&mut root)?;
    serde_yaml::to_string(&root).context("serializing patched workflow YAML")
}

/// Parse a YAML fragment (used by workflow `patch` fns to build ordered blocks).
fn yaml_fragment(s: &str) -> Result<serde_yaml::Value> {
    serde_yaml::from_str(s).context("parsing YAML fragment")
}

/// Look up `jobs.<id>` in a rendered workflow as a mutable mapping.
fn job_mut<'a>(root: &'a mut serde_yaml::Value, id: &str) -> Result<&'a mut serde_yaml::Mapping> {
    root.get_mut("jobs")
        .and_then(|jobs| jobs.get_mut(id))
        .and_then(serde_yaml::Value::as_mapping_mut)
        .with_context(|| format!("job `{id}` not found in rendered workflow"))
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
        slug: "build_agent_daemon_on_tag",
        file_name: "build_agent_daemon_on_tag.yml",
        render_yaml: || render_gh_workflow(build_agent_daemon_on_tag::build_agent_daemon_on_tag)(),
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
        slug: "code_check_infra",
        file_name: "code_check_infra.yml",
        render_yaml: || render_gh_workflow(code_check_infra::code_check_infra)(),
    },
    WorkflowFile {
        slug: "cancel_stuck_cloud_storage_deploys",
        file_name: "cancel_stuck_cloud_storage_deploys.yml",
        render_yaml: || {
            render_patched(
                cancel_stuck_cloud_storage_deploys::cancel_stuck_cloud_storage_deploys,
                cancel_stuck_cloud_storage_deploys::patch,
            )
        },
    },
    WorkflowFile {
        slug: "cargo_deny",
        file_name: "cargo_deny.yml",
        render_yaml: || render_gh_workflow(cargo_deny::cargo_deny)(),
    },
    WorkflowFile {
        slug: "cargo_workspace_dependency_check",
        file_name: "cargo_workspace_dependency_check.yml",
        render_yaml: || {
            render_gh_workflow(cargo_workspace_dependency_check::cargo_workspace_dependency_check)()
        },
    },
    WorkflowFile {
        slug: "cla",
        file_name: "cla.yml",
        render_yaml: || render_gh_workflow(cla::cla)(),
    },
    WorkflowFile {
        slug: "cleanup_preview",
        file_name: "cleanup_preview.yml",
        render_yaml: || render_gh_workflow(cleanup_preview::cleanup_preview)(),
    },
    WorkflowFile {
        slug: "code_check_cloud_storage",
        file_name: "code_check_cloud_storage.yml",
        render_yaml: || render_gh_workflow(code_check_cloud_storage::code_check_cloud_storage)(),
    },
    WorkflowFile {
        slug: "code_check_conventions",
        file_name: "code_check_conventions.yml",
        render_yaml: || render_gh_workflow(code_check_conventions::code_check_conventions)(),
    },
    WorkflowFile {
        slug: "deploy_ai_editing_worker",
        file_name: "deploy_ai_editing_worker.yml",
        render_yaml: || {
            render_patched(
                deploy_ai_editing_worker::deploy_ai_editing_worker,
                deploy_ai_editing_worker::patch,
            )
        },
    },
    WorkflowFile {
        slug: "deploy_all_services",
        file_name: "deploy_all_services.yml",
        render_yaml: || {
            render_patched(
                deploy_all_services::deploy_all_services,
                deploy_all_services::patch,
            )
        },
    },
    WorkflowFile {
        slug: "deploy_cla_worker",
        file_name: "deploy_cla_worker.yml",
        render_yaml: || render_gh_workflow(deploy_cla_worker::deploy_cla_worker)(),
    },
    WorkflowFile {
        slug: "deploy_on_push",
        file_name: "deploy_on_push.yml",
        render_yaml: || {
            let yaml = render_patched(deploy_on_push::deploy_on_push, deploy_on_push::patch)?;
            Ok(format!("{}{yaml}", deploy_on_push::NOTICE))
        },
    },
    WorkflowFile {
        slug: "deploy_fusionauth_instance",
        file_name: "deploy_fusionauth_instance.yml",
        render_yaml: || {
            render_patched(
                deploy_fusionauth_instance::deploy_fusionauth_instance,
                deploy_fusionauth_instance::patch,
            )
        },
    },
    WorkflowFile {
        slug: "deploy_preview",
        file_name: "deploy_preview.yml",
        render_yaml: || render_gh_workflow(deploy_preview::deploy_preview)(),
    },
    WorkflowFile {
        slug: "deploy_sync_service",
        file_name: "deploy_sync_service.yml",
        render_yaml: || {
            render_patched(
                deploy_sync_service::deploy_sync_service,
                deploy_sync_service::patch,
            )
        },
    },
    WorkflowFile {
        slug: "deploy_web_app",
        file_name: "deploy_web_app.yml",
        render_yaml: || render_patched(deploy_web_app::deploy_web_app, deploy_web_app::patch),
    },
    WorkflowFile {
        slug: "ensure_daytona_snapshot",
        file_name: "ensure_daytona_snapshot.yml",
        render_yaml: || render_gh_workflow(ensure_daytona_snapshot::ensure_daytona_snapshot)(),
    },
    WorkflowFile {
        slug: "push_local_stack_binaries",
        file_name: "push_local_stack_binaries.yml",
        render_yaml: || render_gh_workflow(push_local_stack_binaries::push_local_stack_binaries)(),
    },
    WorkflowFile {
        slug: "pulumi_preview_pr",
        file_name: "pulumi_preview_pr.yml",
        render_yaml: || {
            render_patched(
                pulumi_preview_pr::pulumi_preview_pr,
                pulumi_preview_pr::patch,
            )
        },
    },
    WorkflowFile {
        slug: "reusable_deploy_service",
        file_name: "reusable_deploy_service.yml",
        render_yaml: || {
            render_patched(
                reusable_deploy_service::reusable_deploy_service,
                reusable_deploy_service::patch,
            )
        },
    },
    WorkflowFile {
        slug: "reusable_preview_service",
        file_name: "reusable_preview_service.yml",
        render_yaml: || {
            render_patched(
                reusable_preview_service::reusable_preview_service,
                reusable_preview_service::patch,
            )
        },
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
    WorkflowFile {
        slug: "sdk_check",
        file_name: "sdk-check.yml",
        render_yaml: || render_gh_workflow(sdk_check::sdk_check)(),
    },
    WorkflowFile {
        slug: "docs_check",
        file_name: "docs-check.yml",
        render_yaml: || render_gh_workflow(docs_check::docs_check)(),
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
            "generated workflows are stale: {}\nrun `cargo x workflows` from the repository root and commit the result",
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
    path_validation::validate(workflow.file_name, &yaml, &xtask_paths::repo_root())?;
    Ok(format!("{}{yaml}", disclaimer(workflow.slug)))
}

/// The header every generated file starts with.
fn disclaimer(source: &str) -> String {
    format!(
        "# DO NOT EDIT — regenerate with `cargo x workflows` (from the repository root).\n\
         # Source: tooling/xtask/crates/xtask_workflows/src/workflows/{source}.rs\n",
    )
}

/// `<repo-root>/.github/workflows`. Anchored on the repo root (from
/// [`xtask_paths`]) so the task works from any cwd.
fn workflows_dir() -> Result<PathBuf> {
    let dir = xtask_paths::repo_root().join(".github").join("workflows");
    if !dir.is_dir() {
        bail!("expected a workflows directory at {}", dir.display());
    }
    Ok(dir)
}
