//! What `--enforce` fails on, and what the scenarios kept for known bugs
//! add to it.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use rootcause::prelude::*;
use syn::visit::Visit;

use super::junit::{self, Outcome};
use super::ledger::{self, Ledger};
use super::{GMAIL, JUNIT_NAME, KNOWN_BUG, Model, OUTLOOK, Status, evidence};

/// Where the scenarios are.
const SCENARIOS_DIR: &str = "crates/email_e2e/tests";

/// What the reason of an `#[ignore]` starts with on a scenario kept for a
/// known bug; the bug's id follows.
const KEPT_FOR: &str = "known bug: ";

impl Model {
    /// What `--enforce` fails on: a scenario that failed; a function that is
    /// not proved on a provider and neither waived nor held open by a known
    /// bug; an entry point that is neither reached, waived nor deferred;
    /// what the ledger says and the records do not bear out; and a scenario
    /// kept for a known bug that passes.
    pub(super) fn find_gaps(&self) -> Vec<String> {
        let mut gaps: Vec<String> = self
            .suite
            .failed
            .iter()
            .map(|scenario| format!("scenario `{scenario}` failed"))
            .collect();
        // The functions a known bug keeps open, per provider: their scenarios
        // cannot pass, so the entry points only they reach cannot be reached.
        let mut held_open: BTreeSet<(&str, &str)> = BTreeSet::new();
        for row in &self.functions {
            for (provider, cell) in [(GMAIL, &row.gmail), (OUTLOOK, &row.outlook)] {
                let Some(cell) = cell else { continue };
                let known_bug = cell
                    .reason
                    .as_deref()
                    .is_some_and(|reason| reason.starts_with(KNOWN_BUG));
                if cell.status == Status::Open && known_bug {
                    held_open.insert((row.id.as_str(), provider));
                }
                let state = match cell.status {
                    Status::Open if known_bug => continue,
                    Status::Open => "no scenario performs it",
                    Status::Performed => "scenarios perform it and none is said to check it",
                    Status::Claimed => "no break has proved the scenarios that check it",
                    _ => continue,
                };
                gaps.push(format!(
                    "function {} ({}) is not proved on {provider}: {state}",
                    row.id, row.function
                ));
            }
        }
        for row in &self.entry_rows {
            for (provider, cell) in [(GMAIL, &row.gmail), (OUTLOOK, &row.outlook)] {
                let open = cell
                    .as_ref()
                    .is_some_and(|cell| cell.status == Status::Open);
                let behind_a_bug = !row.functions.is_empty()
                    && row
                        .functions
                        .iter()
                        .all(|function| held_open.contains(&(function.as_str(), provider)));
                if open && !behind_a_bug {
                    gaps.push(format!(
                        "entry point `{} {}` is not reached on {provider}, and is neither \
                         waived nor deferred",
                        row.kind, row.key
                    ));
                }
            }
        }
        gaps.extend(self.stale.iter().cloned());
        gaps
    }
}

/// Reads the results of the known-bug runs, one directory per job that runs
/// them, and adds what they show to the model. A directory without results
/// is an error: the scenarios of that job would otherwise go unjudged.
pub(super) fn read_known_bugs(
    model: &mut Model,
    ledger: &Ledger,
    dirs: &[PathBuf],
) -> Result<(), Report> {
    let mut files = Vec::new();
    for dir in dirs {
        let found = if dir.is_dir() {
            evidence::files_named(std::slice::from_ref(dir), JUNIT_NAME)?
        } else {
            Vec::new()
        };
        if found.is_empty() {
            model.broken.push(format!(
                "no {JUNIT_NAME} under --known-bugs {}: nothing says whether the scenarios \
                 kept for known bugs still fail there",
                dir.display()
            ));
        }
        files.extend(found);
    }
    // A job whose last known bug was fixed runs no scenario.
    let known_bugs = junit::load_runs_that_may_be_empty(&files)?;
    judge_known_bugs(model, ledger, &known_bugs);
    Ok(())
}

/// Adds what the runs of the scenarios kept for known bugs show: one that
/// passes at the first attempt is a gap (its bug is gone, so the scenario
/// should gate and the function's `bug` line go) unless the ledger says the
/// bug shows only now and then. One that failed and then passed when tried
/// again still shows its bug.
pub(crate) fn judge_known_bugs(model: &mut Model, ledger: &Ledger, known_bugs: &junit::Results) {
    let intermittent: BTreeSet<&str> = ledger
        .waivers
        .intermittent_bug
        .iter()
        .map(|bug| bug.scenario.as_str())
        .collect();
    for (scenario, outcome) in &known_bugs.outcomes {
        if matches!(outcome, Outcome::Failed | Outcome::Flaky(_)) {
            model.suite.known_bugs_failing += 1;
            continue;
        }
        model.suite.known_bugs_passing.push(scenario.clone());
        if !intermittent.contains(scenario.as_str()) {
            model.gaps.push(format!(
                "scenario `{scenario}`, kept for a known bug, passes: remove its `#[ignore]` so \
                 it gates, and the `bug` line of its function in {}",
                ledger::MAP_PATH
            ));
        }
    }
    for bug in &ledger.waivers.intermittent_bug {
        if !known_bugs.outcomes.contains_key(&bug.scenario) {
            model.gaps.push(format!(
                "{}: [[intermittent_bug]] names `{}`, which is not among the scenarios kept \
                 for known bugs",
                ledger::WAIVERS_PATH,
                bug.scenario
            ));
        }
    }
}

/// What the ledger says of known bugs that the scenarios do not bear out: a
/// function held open by a bug no scenario is kept for would stay open, and
/// out of the gaps, for good.
pub(super) fn unkept_bugs(root: &Path, ledger: &Ledger) -> Result<Vec<String>, Report> {
    let dir = root.join(SCENARIOS_DIR);
    let mut kept = BTreeSet::new();
    let mut problems = Vec::new();
    let entries = std::fs::read_dir(&dir).context(format!("could not read {}", dir.display()))?;
    for entry in entries {
        let path = entry
            .context(format!("could not read {}", dir.display()))?
            .path();
        if path.extension().is_none_or(|extension| extension != "rs") {
            continue;
        }
        let text =
            std::fs::read_to_string(&path).context(format!("could not read {}", path.display()))?;
        let (ids, others) =
            ignored(&text).context(format!("could not parse {}", path.display()))?;
        kept.extend(ids);
        if others > 0 {
            // The known-bug runs take every ignored scenario.
            problems.push(format!(
                "{}: {others} `#[ignore]` without the reason `{KEPT_FOR}<id>`: a scenario is \
                 ignored only for a known bug",
                path.display()
            ));
        }
    }
    for (id, mapping) in &ledger.map.functions {
        if let Some(bug) = &mapping.bug
            && !kept.contains(bug)
        {
            problems.push(format!(
                "{}: {id} is held open by the bug `{bug}`, which no scenario is kept for \
                 (`#[ignore = \"{KEPT_FOR}{bug}\"]`): remove the `bug` line",
                ledger::MAP_PATH
            ));
        }
    }
    problems.sort();
    Ok(problems)
}

/// The bug ids the `#[ignore]`s of a scenario file name, and how many of
/// its `#[ignore]`s name none.
/// Only attributes count: one written in a comment or a string ignores
/// nothing.
pub(crate) fn ignored(text: &str) -> Result<(Vec<String>, usize), syn::Error> {
    let file = syn::parse_file(text)?;
    let mut ignores = Ignores::default();
    ignores.visit_file(&file);
    Ok((ignores.ids, ignores.others))
}

#[derive(Default)]
struct Ignores {
    ids: Vec<String>,
    others: usize,
}

impl<'ast> Visit<'ast> for Ignores {
    fn visit_attribute(&mut self, attribute: &'ast syn::Attribute) {
        if !attribute.path().is_ident("ignore") {
            return;
        }
        let reason = match &attribute.meta {
            syn::Meta::NameValue(syn::MetaNameValue {
                value:
                    syn::Expr::Lit(syn::ExprLit {
                        lit: syn::Lit::Str(reason),
                        ..
                    }),
                ..
            }) => Some(reason.value()),
            _ => None,
        };
        match reason
            .as_deref()
            .and_then(|reason| reason.strip_prefix(KEPT_FOR))
        {
            Some(id) => self.ids.push(id.to_owned()),
            None => self.others += 1,
        }
    }
}
