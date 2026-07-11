//! Validate checkout-backed paths embedded in rendered GitHub workflows.

use std::path::Path;

use anyhow::{Context, Result, bail};
use serde_yaml::Value;
use xtask_paths::{RepoDir, RepoFile, RepoGlob};

/// Validate all repository paths that live in structurally identifiable
/// workflow fields. Runtime outputs such as artifact upload paths are
/// deliberately not checked against the checkout.
pub(super) fn validate(workflow_name: &str, yaml: &str, repo_root: &Path) -> Result<()> {
    let root: Value = serde_yaml::from_str(yaml)
        .with_context(|| format!("parsing rendered workflow `{workflow_name}` for path checks"))?;

    validate_trigger_paths(workflow_name, &root, repo_root)?;
    validate_jobs(workflow_name, &root, repo_root)
}

fn validate_trigger_paths(workflow_name: &str, root: &Value, repo_root: &Path) -> Result<()> {
    let Some(events) = root.get("on").and_then(Value::as_mapping) else {
        return Ok(());
    };

    for (event_name, event) in events {
        let Some(event) = event.as_mapping() else {
            continue;
        };
        for field in ["paths", "paths-ignore"] {
            let Some(paths) = event.get(field).and_then(Value::as_sequence) else {
                continue;
            };
            for path in paths {
                let path = path.as_str().with_context(|| {
                    format!(
                        "workflow `{workflow_name}` event `{}` has a non-string `{field}` entry",
                        yaml_key(event_name)
                    )
                })?;
                validate_glob(
                    path,
                    repo_root,
                    format!(
                        "workflow `{workflow_name}` event `{}` `{field}`",
                        yaml_key(event_name)
                    ),
                )?;
            }
        }
    }
    Ok(())
}

fn validate_jobs(workflow_name: &str, root: &Value, repo_root: &Path) -> Result<()> {
    let Some(jobs) = root.get("jobs").and_then(Value::as_mapping) else {
        return Ok(());
    };

    for (job_name, job) in jobs {
        let job_name = yaml_key(job_name);
        let Some(job) = job.as_mapping() else {
            continue;
        };

        if let Some(local_workflow) = job
            .get("uses")
            .and_then(Value::as_str)
            .and_then(strip_local_prefix)
        {
            validate_file(
                local_workflow,
                repo_root,
                format!("workflow `{workflow_name}` job `{job_name}` local reusable workflow"),
            )?;
        }

        if let Some(working_directory) = job
            .get("defaults")
            .and_then(|defaults| defaults.get("run"))
            .and_then(|run| run.get("working-directory"))
            .and_then(Value::as_str)
        {
            validate_dir(
                working_directory,
                repo_root,
                format!("workflow `{workflow_name}` job `{job_name}` default working directory"),
            )?;
        }

        let Some(steps) = job.get("steps").and_then(Value::as_sequence) else {
            continue;
        };
        for (step_index, step) in steps.iter().enumerate() {
            validate_step(workflow_name, &job_name, step_index, step, repo_root)?;
        }
    }
    Ok(())
}

fn validate_step(
    workflow_name: &str,
    job_name: &str,
    step_index: usize,
    step: &Value,
    repo_root: &Path,
) -> Result<()> {
    let Some(step) = step.as_mapping() else {
        return Ok(());
    };
    let step_name = step
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("step {}", step_index + 1));
    let context = || format!("workflow `{workflow_name}` job `{job_name}` step `{step_name}`");

    if let Some(working_directory) = step.get("working-directory").and_then(Value::as_str) {
        validate_dir(
            working_directory,
            repo_root,
            format!("{} working directory", context()),
        )?;
    }

    let uses = step.get("uses").and_then(Value::as_str);
    if let Some(local_action) = uses.and_then(strip_local_prefix) {
        validate_dir(
            local_action,
            repo_root,
            format!("{} local action", context()),
        )?;
    }

    let Some(with) = step.get("with").and_then(Value::as_mapping) else {
        return Ok(());
    };
    if let Some(manifest_path) = with.get("manifest-path").and_then(Value::as_str) {
        validate_file(
            manifest_path,
            repo_root,
            format!("{} manifest path", context()),
        )?;
    }

    match uses {
        Some(action) if action.starts_with("dorny/paths-filter@") => {
            if let Some(filters) = with.get("filters").and_then(Value::as_str) {
                validate_dorny_filters(filters, repo_root, &context())?;
            }
        }
        Some(action) if action.starts_with("whutchinson98/diff-checker-action@") => {
            if let Some(diff) = with.get("diff").and_then(Value::as_str) {
                validate_diff_checker_paths(diff, repo_root, &context())?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_dorny_filters(filters: &str, repo_root: &Path, context: &str) -> Result<()> {
    let filters: Value = serde_yaml::from_str(filters)
        .with_context(|| format!("{context} contains invalid dorny path-filter YAML"))?;
    let Some(groups) = filters.as_mapping() else {
        bail!("{context} dorny path filters must be a mapping");
    };
    for (group_name, group) in groups {
        let Some(patterns) = group.as_sequence() else {
            bail!(
                "{context} dorny path-filter group `{}` must be a sequence",
                yaml_key(group_name)
            );
        };
        for pattern in patterns {
            let pattern = pattern.as_str().with_context(|| {
                format!(
                    "{context} dorny path-filter group `{}` contains a non-string pattern",
                    yaml_key(group_name)
                )
            })?;
            validate_glob(
                pattern,
                repo_root,
                format!(
                    "{context} dorny path-filter group `{}`",
                    yaml_key(group_name)
                ),
            )?;
        }
    }
    Ok(())
}

fn validate_diff_checker_paths(diff: &str, repo_root: &Path, context: &str) -> Result<()> {
    for line in diff.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let (group, patterns) = line
            .split_once(':')
            .with_context(|| format!("{context} diff-checker entry `{line}` has no group name"))?;
        for pattern in patterns.split_whitespace() {
            let pattern = pattern.strip_prefix("./").unwrap_or(pattern);
            validate_glob(
                pattern,
                repo_root,
                format!("{context} diff-checker group `{group}`"),
            )?;
        }
    }
    Ok(())
}

fn validate_file(path: &str, repo_root: &Path, context: String) -> Result<()> {
    RepoFile::try_new(path)
        .and_then(|path| path.validate_at(repo_root))
        .with_context(|| context)
}

fn validate_dir(path: &str, repo_root: &Path, context: String) -> Result<()> {
    RepoDir::try_new(path)
        .and_then(|path| path.validate_at(repo_root))
        .with_context(|| context)
}

fn validate_glob(path: &str, repo_root: &Path, context: String) -> Result<()> {
    RepoGlob::try_new(path)
        .and_then(|path| path.validate_at(repo_root))
        .with_context(|| context)
}

fn strip_local_prefix(path: &str) -> Option<&str> {
    path.strip_prefix("./")
}

fn yaml_key(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{value:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_checkout_and_runtime_paths_in_their_respective_fields() {
        let yaml = r#"
on:
  pull_request:
    paths:
      - apps/web/**
jobs:
  check:
    steps:
      - name: Build
        working-directory: apps/web
        run: bun run build
      - name: Upload
        uses: actions/upload-artifact@v4
        with:
          path: artifacts/*
"#;
        validate("fixture.yml", yaml, &xtask_paths::repo_root()).unwrap();
    }

    #[test]
    fn rejects_missing_working_directories() {
        let yaml = r#"
jobs:
  check:
    steps:
      - name: Broken
        working-directory: definitely-missing
        run: true
"#;
        let error = validate("fixture.yml", yaml, &xtask_paths::repo_root()).unwrap_err();
        let error = format!("{error:#}");
        assert!(error.contains("working directory"));
        assert!(error.contains("definitely-missing"));
    }

    #[test]
    fn rejects_missing_embedded_path_filters() {
        let yaml = r#"
jobs:
  check:
    steps:
      - name: Filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            changed:
              - definitely-missing/**
"#;
        let error = validate("fixture.yml", yaml, &xtask_paths::repo_root()).unwrap_err();
        let error = format!("{error:#}");
        assert!(error.contains("dorny path-filter group `changed`"));
        assert!(error.contains("matches no paths"));
    }
}
