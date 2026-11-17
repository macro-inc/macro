//! `cargo x workflows diff [--base <rev>]` — what a change to the generated
//! CI YAML means to GitHub, ignoring how it is spelled.
//!
//! Every workflow and composite action is parsed at `<rev>` (default `HEAD`)
//! and in the working tree, and the two trees are compared as data: mapping
//! key order, quoting, block-scalar style and comments do not count. A
//! formatting-only change (a new emitter, reordered keys) must print
//! `no semantic changes`; anything else is listed by its YAML path.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};
use serde_yaml::Value;

/// Directories holding the YAML GitHub reads for CI.
const CI_DIRS: &[&str] = &[".github/workflows", ".github/actions"];

/// Print every semantic difference between `base` and the working tree, and
/// fail if there is one.
pub fn run(base: &str) -> Result<()> {
    let repo_root = xtask_paths::repo_root();
    let mut changes = Vec::new();

    for path in ci_yaml_paths(&repo_root, base)? {
        let before = file_at_rev(&repo_root, base, &path)?;
        let after = file_in_tree(&repo_root, &path)?;
        changes.extend(diff_file(&path, before.as_deref(), after.as_deref())?);
    }

    if changes.is_empty() {
        println!("no semantic changes against {base}");
        return Ok(());
    }

    for change in &changes {
        println!("{change}");
    }
    bail!("{} semantic change(s) against {base}", changes.len())
}

/// Semantic differences between two versions of one file, `None` meaning the
/// file does not exist on that side.
pub fn diff_file(path: &str, before: Option<&str>, after: Option<&str>) -> Result<Vec<String>> {
    let parse = |side: &str, text: &str| -> Result<Value> {
        serde_yaml::from_str(text).with_context(|| format!("parsing {side} {path}"))
    };

    let mut changes = Vec::new();
    match (before, after) {
        (None, None) => {}
        (None, Some(_)) => changes.push(format!("{path}: added")),
        (Some(_), None) => changes.push(format!("{path}: removed")),
        (Some(before), Some(after)) => {
            let before = parse("base", before)?;
            let after = parse("working tree", after)?;
            diff_value(path, &before, &after, &mut changes);
        }
    }
    Ok(changes)
}

/// Walk both trees and record each path where they differ. Mappings compare by
/// key, so order never counts; sequences compare by position.
fn diff_value(at: &str, before: &Value, after: &Value, changes: &mut Vec<String>) {
    match (before, after) {
        (Value::Mapping(before), Value::Mapping(after)) => {
            for (key, value) in before {
                let child = format!("{at}.{}", key_label(key));
                match after.get(key) {
                    Some(other) => diff_value(&child, value, other, changes),
                    None => changes.push(format!("{child}: removed")),
                }
            }
            for key in after.keys().filter(|key| !before.contains_key(*key)) {
                changes.push(format!("{at}.{}: added", key_label(key)));
            }
        }

        (Value::Sequence(before), Value::Sequence(after)) => {
            for (index, (left, right)) in before.iter().zip(after).enumerate() {
                diff_value(&format!("{at}[{index}]"), left, right, changes);
            }
            if before.len() != after.len() {
                changes.push(format!(
                    "{at}: {} item(s) before, {} after",
                    before.len(),
                    after.len()
                ));
            }
        }

        _ if before == after => {}

        _ => changes.push(format!(
            "{at}: {} -> {}",
            scalar_label(before),
            scalar_label(after)
        )),
    }
}

fn key_label(key: &Value) -> String {
    match key {
        Value::String(key) => key.clone(),
        other => scalar_label(other),
    }
}

fn scalar_label(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}"))
}

/// Workflow and action YAML files present at `base` or in the working tree.
fn ci_yaml_paths(repo_root: &Path, base: &str) -> Result<BTreeSet<String>> {
    let output = Command::new("git")
        .args(["ls-tree", "-r", "--name-only", base, "--"])
        .args(CI_DIRS)
        .current_dir(repo_root)
        .output()
        .context("running git ls-tree")?;
    if !output.status.success() {
        bail!(
            "git ls-tree {base} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let mut paths: BTreeSet<String> = String::from_utf8(output.stdout)
        .context("git ls-tree output is not UTF-8")?
        .lines()
        .map(str::to_owned)
        .collect();
    for dir in CI_DIRS {
        collect_tree_paths(repo_root, dir, &mut paths)?;
    }

    paths.retain(|path| path.ends_with(".yml") || path.ends_with(".yaml"));
    Ok(paths)
}

fn collect_tree_paths(repo_root: &Path, dir: &str, paths: &mut BTreeSet<String>) -> Result<()> {
    let entries = fs::read_dir(repo_root.join(dir)).with_context(|| format!("reading {dir}"))?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let path = format!("{dir}/{}", name.to_string_lossy());
        if entry.file_type()?.is_dir() {
            collect_tree_paths(repo_root, &path, paths)?;
        } else {
            paths.insert(path);
        }
    }
    Ok(())
}

fn file_at_rev(repo_root: &Path, rev: &str, path: &str) -> Result<Option<String>> {
    let output = Command::new("git")
        .args(["show", &format!("{rev}:{path}")])
        .current_dir(repo_root)
        .output()
        .context("running git show")?;
    if !output.status.success() {
        return Ok(None);
    }
    String::from_utf8(output.stdout)
        .map(Some)
        .with_context(|| format!("{rev}:{path} is not UTF-8"))
}

fn file_in_tree(repo_root: &Path, path: &str) -> Result<Option<String>> {
    match fs::read_to_string(repo_root.join(path)) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("reading {path}")),
    }
}

#[cfg(test)]
mod test;
