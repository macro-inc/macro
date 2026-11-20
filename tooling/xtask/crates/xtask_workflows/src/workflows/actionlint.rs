//! `.github/actionlint.yaml`, generated: the runner labels every workflow's
//! `runs-on` uses (so actionlint knows our self-hosted and Namespace labels,
//! and the list can't drift from [`super::runners`]), and the shellcheck
//! findings we keep on purpose.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use anyhow::{Context, Result, bail};
use serde_yaml::Value;

/// Path, relative to the repository root.
pub const PATH: &str = ".github/actionlint.yaml";

/// A shellcheck finding kept on purpose: `(workflow file, check, reason)`.
/// One file and check per entry; any other finding still fails.
const SHELLCHECK_IGNORES: &[(&str, &str, &str)] = &[
    (
        "android-play-publish.yml",
        "SC2016",
        "The GraphQL query passed to `gh api` is single-quoted so gh, not bash, binds $owner.",
    ),
    (
        "android-release-drift.yml",
        "SC2016",
        "The GraphQL query passed to `gh api` is single-quoted so gh, not bash, binds $owner.",
    ),
    (
        "android-release-watch.yml",
        "SC2016",
        "The GraphQL query passed to `gh api` is single-quoted so gh, not bash, binds $owner.",
    ),
    (
        "android-release-watch.yml",
        "SC2329",
        "The shared Android helper prelude defines functions this step does not call.",
    ),
    (
        "web-app-check-main.yml",
        "SC2016",
        "The GraphQL query passed to `gh api` is single-quoted so gh, not bash, binds $owner.",
    ),
    (
        "web-app-check-main.yml",
        "SC2329",
        "The shared Android helper prelude defines functions this step does not call.",
    ),
    (
        "ios_preview.yml",
        "SC2016",
        "The script for `nix develop -c bash -c` is single-quoted so the inner shell expands it.",
    ),
    (
        "pr-privacy-check.yml",
        "SC2016",
        "The awk program is single-quoted so awk, not bash, reads `$text` fences.",
    ),
    (
        "publish-android-play.yml",
        "SC2016",
        "The backticks are Markdown in a printf format string, not command substitution.",
    ),
    (
        "pulumi_preview_pr.yml",
        "SC2053",
        "`[[ $file == $stack_path ]]` is a deliberate glob match against the stack path pattern.",
    ),
    (
        "code_check_cloud_storage.yml",
        "SC2044",
        "The loop over `find` counts the crates it dates in the shell itself; workspace `.env` paths have no spaces.",
    ),
    (
        "deploy_all_services.yml",
        "SC2129",
        "Each matrix output is its own `>> \"$GITHUB_OUTPUT\"` line, kept for readability.",
    ),
];

/// GitHub-hosted runner label prefixes actionlint already knows.
const GITHUB_HOSTED: &[&str] = &["ubuntu-", "macos-", "windows-"];

/// Render the config from every workflow GitHub runs, keyed by file name.
pub fn render(workflows: &BTreeMap<String, String>) -> Result<String> {
    let mut labels = BTreeSet::new();
    for (file, yaml) in workflows {
        let workflow: Value =
            serde_yaml::from_str(yaml).with_context(|| format!("parsing {file}"))?;
        let jobs = workflow
            .get("jobs")
            .and_then(Value::as_mapping)
            .into_iter()
            .flatten();
        for (_, job) in jobs {
            let runs_on: Vec<&str> = match job.get("runs-on") {
                Some(Value::String(label)) => vec![label.as_str()],
                Some(Value::Sequence(items)) => items.iter().filter_map(Value::as_str).collect(),
                _ => Vec::new(),
            };
            labels.extend(
                runs_on
                    .into_iter()
                    .filter(|label| {
                        !label.contains("${{")
                            && !GITHUB_HOSTED.iter().any(|prefix| label.starts_with(prefix))
                    })
                    .map(str::to_string),
            );
        }
    }

    let mut out = String::from(
        "# DO NOT EDIT — regenerate with `cargo x workflows` (from the repository root).\n\
         # Source: tooling/xtask/crates/xtask_workflows/src/workflows/actionlint.rs\n\
         self-hosted-runner:\n  labels:\n",
    );
    for label in &labels {
        writeln!(out, "    - {label}")?;
    }

    out.push_str(
        "\n# shellcheck findings kept on purpose, one file and check per entry. A new\n\
         # finding of another kind, or in another file, still fails.\npaths:\n",
    );
    let mut by_file: BTreeMap<&str, Vec<(&str, &str)>> = BTreeMap::new();
    for (file, check, reason) in SHELLCHECK_IGNORES {
        if !workflows.contains_key(*file) {
            bail!("{PATH}: shellcheck ignore for {file}, which is not a workflow");
        }
        by_file.entry(file).or_default().push((check, reason));
    }
    for (file, ignores) in by_file {
        writeln!(out, "  .github/workflows/{file}:\n    ignore:")?;
        for (check, reason) in ignores {
            writeln!(out, "      # {reason}\n      - '{check}:'")?;
        }
    }
    Ok(out)
}
