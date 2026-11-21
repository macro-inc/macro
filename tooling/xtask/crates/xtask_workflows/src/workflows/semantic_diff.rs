//! `cargo x workflows diff [--base <rev>]` — what a change to the generated
//! CI YAML means to GitHub, ignoring how it is spelled.
//!
//! Every workflow and composite action is parsed at `<rev>` (default `HEAD`)
//! and in the working tree, and the two trees are compared as data: mapping
//! key order, quoting, block-scalar style, comments, and the spacing and
//! redundant parentheses of `${{ }}` expressions do not count. A
//! formatting-only change (a new emitter, reordered keys, re-spelled
//! expressions) must print `no semantic changes`; anything else is listed by
//! its YAML path.
//!
//! Two more spellings are the same value to GitHub. An action step's `with:`
//! input is always a string, so `false` and `'false'` there are equal; a
//! reusable workflow's `with:` stays strict, since its boolean and number
//! inputs are typed. A trigger under `on:` with no settings reads the same as
//! `null` or `{}`.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};
use gh_workflow::expr::{self, TemplatePart};
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
            diff_value(path, &before, &after, Scalars::Typed, &mut changes);
        }
    }
    Ok(changes)
}

/// How scalars of different YAML types compare.
#[derive(Clone, Copy)]
enum Scalars {
    /// `false`, `'false'` and `0` are all different values.
    Typed,
    /// A boolean or number equals its string spelling: an action input,
    /// which GitHub passes to the action as a string.
    ActionInput,
}

/// Walk both trees and record each path where they differ. Mappings compare by
/// key, so order never counts; sequences compare by position.
fn diff_value(
    at: &str,
    before: &Value,
    after: &Value,
    scalars: Scalars,
    changes: &mut Vec<String>,
) {
    match (before, after) {
        (Value::Mapping(before), Value::Mapping(after)) => {
            let action_step = is_step(at) && (is_action(before) || is_action(after));
            for (key, value) in before {
                let child = format!("{at}.{}", key_label(key));
                let scalars = if action_step && key.as_str() == Some("with") {
                    Scalars::ActionInput
                } else {
                    scalars
                };
                match after.get(key) {
                    Some(other) => diff_value(&child, value, other, scalars, changes),
                    None => changes.push(format!("{child}: removed")),
                }
            }
            for key in after.keys().filter(|key| !before.contains_key(*key)) {
                changes.push(format!("{at}.{}: added", key_label(key)));
            }
        }

        (Value::Sequence(before), Value::Sequence(after)) => {
            for (index, (left, right)) in before.iter().zip(after).enumerate() {
                diff_value(&format!("{at}[{index}]"), left, right, scalars, changes);
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

        (Value::String(before), Value::String(after))
            if same_expressions(before, after, is_condition(at)) => {}

        _ if matches!(scalars, Scalars::ActionInput)
            && input_text(before).is_some_and(|text| input_text(after) == Some(text)) => {}

        _ if is_trigger(at) && is_empty_trigger(before) && is_empty_trigger(after) => {}

        _ => changes.push(format!(
            "{at}: {} -> {}",
            scalar_label(before),
            scalar_label(after)
        )),
    }
}

/// Whether `at` is a step: an item of a job's or composite action's `steps`.
fn is_step(at: &str) -> bool {
    at.rsplit_once('.')
        .is_some_and(|(_, last)| last.starts_with("steps[") && last.ends_with(']'))
}

/// Whether a step runs an action, published (`owner/repo@ref`) or local
/// (`./path`), whose `with:` inputs GitHub hands over as strings.
fn is_action(step: &serde_yaml::Mapping) -> bool {
    step.get("uses")
        .and_then(Value::as_str)
        .is_some_and(|uses| !uses.starts_with("docker://"))
}

/// The string GitHub passes an action for a scalar input. Only booleans and
/// integers: GitHub may re-spell a float (`3.0` as `3`), so a float and a
/// string stay different.
fn input_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Number(number) if number.is_i64() || number.is_u64() => Some(number.to_string()),
        _ => None,
    }
}

/// The path segments after the file name, which itself contains dots.
fn segments(at: &str) -> Vec<&str> {
    let after_file = [".yml.", ".yaml."]
        .iter()
        .find_map(|extension| at.split_once(extension).map(|(_, rest)| rest))
        .unwrap_or(at);
    after_file.split('.').collect()
}

/// Whether `at` is an `if:` GitHub evaluates: a job's, a step's, or a
/// composite action step's, not an input or env var named `if`.
fn is_condition(at: &str) -> bool {
    match segments(at).as_slice() {
        ["jobs", _, "if"] => true,
        ["jobs", _, steps, "if"] | ["runs", steps, "if"] => steps.starts_with("steps["),
        _ => false,
    }
}

/// Whether `at` is an event directly under a workflow's `on:`.
fn is_trigger(at: &str) -> bool {
    matches!(segments(at).as_slice(), ["on", _])
}

fn is_empty_trigger(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Mapping(settings) => settings.is_empty(),
        _ => false,
    }
}

/// Whether two strings differ only in how their expressions are spelled:
/// spacing and redundant parentheses. `whole_expression` is an `if:` value,
/// which is an expression even without `${{ }}`.
fn same_expressions(before: &str, after: &str, whole_expression: bool) -> bool {
    let meaning = |text: &str| -> Option<Vec<String>> {
        if whole_expression && !text.contains("${{") {
            return expr::parse(text)
                .ok()
                .map(|ast| vec![ast.meaning().to_string()]);
        }
        let parts = expr::parse_template(text).ok()?;
        // `if: ${{ x }}` and `if: x` are the same condition.
        if let [TemplatePart::Expression(ast)] = parts.as_slice()
            && whole_expression
        {
            return Some(vec![ast.meaning().to_string()]);
        }
        Some(
            parts
                .into_iter()
                .map(|part| match part {
                    TemplatePart::Text(text) => text.to_string(),
                    TemplatePart::Expression(ast) => {
                        format!("${{{{ {} }}}}", ast.meaning())
                    }
                })
                .collect(),
        )
    };
    matches!((meaning(before), meaning(after)), (Some(before), Some(after)) if before == after)
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
