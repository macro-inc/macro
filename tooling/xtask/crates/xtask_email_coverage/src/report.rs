//! The coverage report: which functions of email the end-to-end scenarios
//! perform and check on each provider, and which backend entry points they
//! reach.
//!
//! A function is something a user or the system does with mail (star a
//! thread, refresh a token). It is **claimed** on a provider when a scenario
//! that passed on an inbox of that provider performed it (the record the
//! harness wrote shows the requests `functions.toml` names for it) and
//! `checks.tsv` says that scenario checks its result. It is **proved** when
//! `proofs.tsv` also names a break in product code that made such a scenario
//! fail there: only that counts as covered. It is **performed** when a
//! scenario did it and none is said to check it. Entry points are the detail
//! under the functions: a row is covered when a passing scenario reached it.

mod evidence;
mod graphql;
mod junit;
mod ledger;
mod render;
mod seen;
#[cfg(test)]
mod test;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use rootcause::prelude::*;
use serde::Serialize;

use self::junit::Outcome;
use self::ledger::{Atom, Ledger, Mapping, Proof};
use self::seen::{Reader, Scenario};
use crate::{ENTRYPOINTS_PATH, Kind, Providers, Row, Sources, read_tsv};

pub(crate) const GMAIL: &str = "gmail";
pub(crate) const OUTLOOK: &str = "outlook";
const PROVIDERS: [&str; 2] = [GMAIL, OUTLOOK];
/// The name of a results file nextest writes.
const JUNIT_NAME: &str = "junit.xml";
/// How many scenarios a cell names.
const EXAMPLES: usize = 3;
/// The kinds whose every entry point must belong to a function.
const MAPPED_KINDS: [Kind; 8] = [
    Kind::Http,
    Kind::Webhook,
    Kind::Graphql,
    Kind::Queue,
    Kind::Kafka,
    Kind::Gateway,
    Kind::Tool,
    Kind::Lambda,
];

/// What to report on and where to write it.
pub struct Options {
    /// Directories holding the scenarios' `evidence.json` files and the
    /// runs' `junit.xml` files, at any depth.
    pub results: Vec<PathBuf>,
    /// Where `coverage.json`, `coverage.md` and `index.html` go.
    pub out: PathBuf,
    /// Fail when a function is neither proved nor waived, or an entry
    /// point is neither reached, waived nor deferred.
    pub enforce: bool,
}

/// How a function or an entry point stands on one provider.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Status {
    /// A function a scenario performs and is said to check, where a break
    /// in product code made that scenario fail.
    Proved,
    /// A function a scenario performs and is said to check; no break has
    /// shown that the scenario fails without it.
    Claimed,
    /// An entry point a scenario reached.
    Covered,
    /// Performed by a scenario that is not said to check it.
    Performed,
    /// Left uncovered on purpose.
    Waived,
    /// An entry point left to the full-stack tier.
    Deferred,
    /// Nothing covers it.
    Open,
}

/// How one row stands on one provider.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Cell {
    pub(crate) status: Status,
    /// How many scenarios reached or performed it.
    pub(crate) scenarios: usize,
    /// A few of them.
    pub(crate) examples: Vec<String>,
    /// Why it is waived or deferred, what was broken to prove it, or the
    /// known bug that keeps it open.
    pub(crate) reason: Option<String>,
}

/// Counts of one group of rows on one provider.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct Tally {
    pub(crate) total: usize,
    /// Functions only.
    pub(crate) proved: usize,
    /// Functions only.
    pub(crate) claimed: usize,
    /// Entry points only: reached.
    pub(crate) covered: usize,
    pub(crate) performed: usize,
    pub(crate) waived: usize,
    /// Entry points only.
    pub(crate) deferred: usize,
    pub(crate) open: usize,
}

impl Tally {
    fn add(&mut self, cell: Option<&Cell>) {
        let Some(cell) = cell else { return };
        self.total += 1;
        match cell.status {
            Status::Proved => self.proved += 1,
            Status::Claimed => self.claimed += 1,
            Status::Covered => self.covered += 1,
            Status::Performed => self.performed += 1,
            Status::Waived => self.waived += 1,
            Status::Deferred => self.deferred += 1,
            Status::Open => self.open += 1,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct FunctionRow {
    pub(crate) id: String,
    pub(crate) area: String,
    pub(crate) function: String,
    /// Why the email backend has no part in it, when it has none.
    pub(crate) ui_only: Option<String>,
    /// Which other service carries it out, when it is deferred to the
    /// full-stack tier.
    pub(crate) deferred: Option<String>,
    /// The known product bug that keeps it open.
    pub(crate) bug: Option<String>,
    pub(crate) gmail: Option<Cell>,
    pub(crate) outlook: Option<Cell>,
}

#[derive(Debug, Serialize)]
pub(crate) struct EntryRow {
    pub(crate) kind: String,
    pub(crate) key: String,
    pub(crate) source: String,
    /// The functions it takes part in.
    pub(crate) functions: Vec<String>,
    pub(crate) gmail: Option<Cell>,
    pub(crate) outlook: Option<Cell>,
}

/// An entry point nothing in the repository calls.
#[derive(Debug, Serialize)]
pub(crate) struct DeadCodeRow {
    pub(crate) entry: String,
    pub(crate) source: String,
    pub(crate) reason: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct KindTotals {
    pub(crate) kind: String,
    pub(crate) gmail: Tally,
    pub(crate) outlook: Tally,
}

#[derive(Debug, Serialize)]
pub(crate) struct RunSummary {
    pub(crate) name: String,
    pub(crate) tests: usize,
    pub(crate) failed: usize,
    pub(crate) flaky: usize,
    pub(crate) seconds: f64,
}

/// The scenarios the report is built from.
#[derive(Debug, Default, Serialize)]
pub(crate) struct Suite {
    /// Scenarios whose record counts.
    pub(crate) recorded: usize,
    pub(crate) runs: Vec<RunSummary>,
    /// Scenarios that passed only when tried again.
    pub(crate) flaky: Vec<String>,
    pub(crate) failed: Vec<String>,
    /// Scenarios that passed and left no record.
    pub(crate) unrecorded: Vec<String>,
    /// Scenarios that linked no inbox: they count for both providers.
    pub(crate) no_inbox: Vec<String>,
    /// Scenarios with inboxes of both providers: they count for both.
    pub(crate) both_providers: Vec<String>,
}

/// The whole report.
#[derive(Debug, Serialize)]
pub(crate) struct Model {
    pub(crate) suite: Suite,
    /// Functions in the list, and those the backend has no part in.
    pub(crate) functions_listed: usize,
    pub(crate) functions_ui_only: usize,
    /// Functions another service carries out, deferred to the full-stack
    /// tier.
    pub(crate) functions_deferred: usize,
    pub(crate) functions_gmail: Tally,
    pub(crate) functions_outlook: Tally,
    pub(crate) functions: Vec<FunctionRow>,
    pub(crate) entry_points: Vec<KindTotals>,
    pub(crate) entry_rows: Vec<EntryRow>,
    /// Waived entry points with no caller in the repository.
    pub(crate) dead_code: Vec<DeadCodeRow>,
    /// Background loops: listed, never counted.
    pub(crate) loops: Vec<String>,
    /// What scenarios made the backend do that is in no list.
    pub(crate) unlisted: Vec<String>,
    /// Where the ledger contradicts itself or the code: always a failure.
    pub(crate) broken: Vec<String>,
    /// Checks, proofs, waivers and deferrals the evidence does not bear out.
    pub(crate) stale: Vec<String>,
}

impl Model {
    /// Whether a function is neither proved nor waived, or an entry point
    /// neither reached, waived nor deferred.
    fn has_gaps(&self) -> bool {
        let gap = |tally: &Tally| tally.open + tally.performed + tally.claimed > 0;
        gap(&self.functions_gmail)
            || gap(&self.functions_outlook)
            || self
                .entry_points
                .iter()
                .any(|kind| gap(&kind.gmail) || gap(&kind.outlook))
            || !self.stale.is_empty()
            || !self.suite.failed.is_empty()
    }
}

/// Writes the report and says whether the run should fail.
pub fn run(root: &Path, options: &Options) -> Result<bool, Report> {
    let rows = read_tsv(&root.join(ENTRYPOINTS_PATH))?;
    let sources = Sources::load(root)?;
    let schema = graphql::Schema::load(root)?;
    let ledger = Ledger::load(root)?;
    let records = evidence::load(&options.results)?;
    let results = junit::load(&evidence::files_named(&options.results, JUNIT_NAME)?)?;

    let reader = Reader {
        rows: &rows,
        sources: &sources,
        schema: &schema,
    };
    let mut model = build(&reader, &ledger, records, &results);
    if results.runs.is_empty() {
        // Without results a record of a scenario that failed after it was
        // written, or of an earlier run, would count.
        model.broken.push(format!(
            "no {JUNIT_NAME} under --results: nothing says which scenarios passed"
        ));
    }

    std::fs::create_dir_all(&options.out)
        .context(format!("could not create {}", options.out.display()))?;
    let write = |name: &str, text: String| {
        let path = options.out.join(name);
        std::fs::write(&path, text).context(format!("could not write {}", path.display()))
    };
    let json = serde_json::to_string_pretty(&model).context("the report does not serialise")?;
    write("coverage.json", json)?;
    write("coverage.md", render::markdown(&model))?;
    write("index.html", render::html(&model))?;

    println!("{}", render::headline(&model));
    for problem in &model.broken {
        eprintln!("error: {problem}");
    }
    let failed = !model.broken.is_empty() || (options.enforce && model.has_gaps());
    Ok(failed)
}

/// Joins the records with the ledger.
pub(crate) fn build(
    reader: &Reader<'_>,
    ledger: &Ledger,
    records: Vec<evidence::Evidence>,
    results: &junit::Results,
) -> Model {
    let mut suite = Suite {
        runs: results
            .runs
            .iter()
            .map(|run| RunSummary {
                name: run.name.clone(),
                tests: run.tests,
                failed: run.failed,
                flaky: run.flaky,
                seconds: run.seconds,
            })
            .collect(),
        ..Suite::default()
    };
    for (name, outcome) in &results.outcomes {
        match outcome {
            Outcome::Failed => suite.failed.push(name.clone()),
            Outcome::Flaky(attempts) => suite
                .flaky
                .push(format!("{name} (passed after {attempts} failed)")),
            Outcome::Passed => {}
        }
    }

    // A record counts when its scenario passed. Without results every
    // record counts: the harness writes one only for a scenario that ended
    // with its services healthy.
    let mut scenarios: BTreeMap<String, Scenario> = BTreeMap::new();
    // Every scenario the results know, passed or not: a proof may name one.
    let mut known: BTreeSet<String> = results.outcomes.keys().cloned().collect();
    for record in records {
        let name = record.scenario();
        known.insert(name.clone());
        let passed = results.outcomes.is_empty()
            || matches!(
                results.outcomes.get(&name),
                Some(Outcome::Passed | Outcome::Flaky(_))
            );
        if passed {
            scenarios.insert(name, Scenario::new(record, reader));
        }
    }
    let scenarios: Vec<Scenario> = scenarios.into_values().collect();
    suite.recorded = scenarios.len();
    let recorded: BTreeSet<String> = scenarios.iter().map(Scenario::name).collect();
    suite.unrecorded = results
        .outcomes
        .iter()
        .filter(|(name, outcome)| **outcome != Outcome::Failed && !recorded.contains(*name))
        .map(|(name, _)| name.clone())
        .collect();
    for scenario in &scenarios {
        match scenario.evidence.providers.len() {
            0 => suite.no_inbox.push(scenario.name()),
            1 => {}
            _ => suite.both_providers.push(scenario.name()),
        }
    }

    let mut broken = Vec::new();
    let mut stale = Vec::new();
    let by_entry: BTreeMap<String, &Row> =
        reader.rows.iter().map(|row| (entry(row), row)).collect();

    // Which entry points each scenario reached.
    let reached: Vec<BTreeSet<String>> = scenarios
        .iter()
        .map(|scenario| {
            reader
                .rows
                .iter()
                .filter(|row| !scenario.hits(row, reader.sources).is_empty())
                .map(entry)
                .collect()
        })
        .collect();

    // Entry points.
    let mut functions_of: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (id, mapping) in &ledger.map.functions {
        for atom in mapping.atoms() {
            if by_entry.contains_key(&atom.entry()) {
                let functions = functions_of.entry(atom.entry()).or_default();
                if !functions.contains(id) {
                    functions.push(id.clone());
                }
            } else {
                broken.push(format!(
                    "{}: [{id}] names `{}`, which is not in {ENTRYPOINTS_PATH}",
                    ledger::MAP_PATH,
                    atom.entry()
                ));
            }
        }
    }
    for name in ledger.map.plumbing.keys() {
        if !by_entry.contains_key(name) {
            broken.push(format!(
                "{}: [plumbing] names `{name}`, which is not in {ENTRYPOINTS_PATH}",
                ledger::MAP_PATH
            ));
        }
    }
    let mut waived_entries: BTreeMap<(String, &str), &str> = BTreeMap::new();
    for waiver in &ledger.waivers.entry_point {
        if !by_entry.contains_key(&waiver.entry) {
            broken.push(format!(
                "{}: waives `{}`, which is not in {ENTRYPOINTS_PATH}",
                ledger::WAIVERS_PATH,
                waiver.entry
            ));
        }
        if let Some(provider) = unknown_provider(waiver.provider.as_deref()) {
            broken.push(format!(
                "{}: a waiver names the provider `{provider}`, which is neither {GMAIL} nor {OUTLOOK}",
                ledger::WAIVERS_PATH
            ));
        }
        for provider in applies(waiver.provider.as_deref()) {
            waived_entries.insert((waiver.entry.clone(), provider), &waiver.reason);
        }
    }
    // An entry point nothing calls is waived on both providers, and listed.
    let mut dead_code = Vec::new();
    for dead in &ledger.waivers.dead_code {
        let Some(row) = by_entry.get(&dead.entry) else {
            broken.push(format!(
                "{}: [[dead_code]] names `{}`, which is not in {ENTRYPOINTS_PATH}",
                ledger::WAIVERS_PATH,
                dead.entry
            ));
            continue;
        };
        for provider in PROVIDERS {
            waived_entries.insert((dead.entry.clone(), provider), &dead.reason);
        }
        dead_code.push(DeadCodeRow {
            entry: dead.entry.clone(),
            source: row.source.clone(),
            reason: dead.reason.clone(),
        });
    }
    let mut deferred_entries: BTreeMap<(String, &str), &str> = BTreeMap::new();
    for deferral in &ledger.waivers.deferred {
        if !by_entry.contains_key(&deferral.entry) {
            broken.push(format!(
                "{}: defers `{}`, which is not in {ENTRYPOINTS_PATH}",
                ledger::WAIVERS_PATH,
                deferral.entry
            ));
        }
        if let Some(provider) = unknown_provider(deferral.provider.as_deref()) {
            broken.push(format!(
                "{}: a deferral names the provider `{provider}`, which is neither {GMAIL} nor {OUTLOOK}",
                ledger::WAIVERS_PATH
            ));
        }
        for provider in applies(deferral.provider.as_deref()) {
            if waived_entries.contains_key(&(deferral.entry.clone(), provider)) {
                broken.push(format!(
                    "{}: `{}` is both waived and deferred on {provider}",
                    ledger::WAIVERS_PATH,
                    deferral.entry
                ));
            }
            deferred_entries.insert((deferral.entry.clone(), provider), &deferral.reason);
        }
    }

    let mut entry_rows = Vec::new();
    let mut entry_totals: BTreeMap<String, KindTotals> = BTreeMap::new();
    let mut loops = Vec::new();
    for row in reader.rows {
        if row.kind == Kind::Loop {
            loops.push(row.key.clone());
            continue;
        }
        let name = entry(row);
        if MAPPED_KINDS.contains(&row.kind)
            && !functions_of.contains_key(&name)
            && !ledger.map.plumbing.contains_key(&name)
        {
            broken.push(format!(
                "`{name}` belongs to no function: add it to a function in {} (or to \
                 [plumbing] with the reason)",
                ledger::MAP_PATH
            ));
        }
        let mut cell = |provider: &'static str| {
            let applies = match row.providers {
                Providers::Both => true,
                Providers::Gmail => provider == GMAIL,
                Providers::Outlook => provider == OUTLOOK,
            };
            applies.then(|| {
                let by: Vec<String> = scenarios
                    .iter()
                    .zip(&reached)
                    .filter(|(scenario, reached)| {
                        scenario.is_of(provider) && reached.contains(&name)
                    })
                    .map(|(scenario, _)| scenario.name())
                    .collect();
                let waiver = waived_entries.get(&(name.clone(), provider)).copied();
                let deferral = deferred_entries.get(&(name.clone(), provider)).copied();
                if !by.is_empty() && (waiver.is_some() || deferral.is_some()) {
                    stale.push(format!(
                        "{}: `{name}` is {} on {provider} and {} scenarios reach it",
                        ledger::WAIVERS_PATH,
                        if waiver.is_some() {
                            "waived"
                        } else {
                            "deferred"
                        },
                        by.len()
                    ));
                }
                if !by.is_empty() {
                    cell_of(Status::Covered, &by, None)
                } else if waiver.is_some() {
                    cell_of(Status::Waived, &by, waiver)
                } else if deferral.is_some() {
                    cell_of(Status::Deferred, &by, deferral)
                } else {
                    cell_of(Status::Open, &by, None)
                }
            })
        };
        let (gmail, outlook) = (cell(GMAIL), cell(OUTLOOK));
        let totals = entry_totals
            .entry(row.kind.to_string())
            .or_insert_with(|| KindTotals {
                kind: row.kind.to_string(),
                gmail: Tally::default(),
                outlook: Tally::default(),
            });
        totals.gmail.add(gmail.as_ref());
        totals.outlook.add(outlook.as_ref());
        entry_rows.push(EntryRow {
            kind: row.kind.to_string(),
            key: row.key.clone(),
            source: row.source.clone(),
            functions: functions_of.get(&name).cloned().unwrap_or_default(),
            gmail,
            outlook,
        });
    }

    // Functions.
    let listed: BTreeSet<&str> = ledger
        .functions
        .iter()
        .map(|function| function.id.as_str())
        .collect();
    for id in ledger.map.functions.keys() {
        if !listed.contains(id.as_str()) {
            broken.push(format!(
                "{}: [{id}] is not a function in {}",
                ledger::MAP_PATH,
                ledger::FUNCTIONS_PATH
            ));
        }
    }
    let mut checked: BTreeSet<(&str, &str)> = BTreeSet::new();
    for (id, scenario) in &ledger.checks {
        if !listed.contains(id.as_str()) {
            broken.push(format!(
                "{}: {id} is not a function in {}",
                ledger::CHECKS_PATH,
                ledger::FUNCTIONS_PATH
            ));
        }
        checked.insert((id.as_str(), scenario.as_str()));
    }
    let mut used_checks: BTreeSet<(&str, &str)> = BTreeSet::new();
    // A proof that names what does not exist is broken; one whose scenario
    // no longer performs and claims the function is stale, further down.
    let mut proofs: Vec<&Proof> = Vec::new();
    for proof in &ledger.proofs {
        let mut wrong = Vec::new();
        if !listed.contains(proof.function.as_str()) {
            wrong.push(format!(
                "{} is not a function in {}",
                proof.function,
                ledger::FUNCTIONS_PATH
            ));
        }
        if !PROVIDERS.contains(&proof.provider.as_str()) {
            wrong.push(format!(
                "the provider `{}` is neither {GMAIL} nor {OUTLOOK}",
                proof.provider
            ));
        }
        if !known.contains(&proof.scenario) {
            wrong.push(format!(
                "the scenario `{}` is not in the results",
                proof.scenario
            ));
        }
        if wrong.is_empty() {
            proofs.push(proof);
        }
        for problem in wrong {
            broken.push(format!("{}: {problem}", ledger::PROOFS_PATH));
        }
    }
    let mut used_proofs: BTreeSet<(&str, &str, &str)> = BTreeSet::new();
    let mut waived_functions: BTreeMap<(&str, &str), &str> = BTreeMap::new();
    for waiver in &ledger.waivers.function {
        if !listed.contains(waiver.id.as_str()) {
            broken.push(format!(
                "{}: waives {}, which is not a function in {}",
                ledger::WAIVERS_PATH,
                waiver.id,
                ledger::FUNCTIONS_PATH
            ));
        }
        if let Some(provider) = unknown_provider(waiver.provider.as_deref()) {
            broken.push(format!(
                "{}: a waiver names the provider `{provider}`, which is neither {GMAIL} nor {OUTLOOK}",
                ledger::WAIVERS_PATH
            ));
        }
        for provider in applies(waiver.provider.as_deref()) {
            waived_functions.insert((waiver.id.as_str(), provider), &waiver.reason);
        }
    }

    let empty = Mapping::default();
    let mut function_rows = Vec::new();
    let (mut functions_gmail, mut functions_outlook) = (Tally::default(), Tally::default());
    let mut functions_ui_only = 0;
    let mut functions_deferred = 0;
    for function in &ledger.functions {
        let mapping = match ledger.map.functions.get(&function.id) {
            Some(mapping) => mapping,
            None => {
                broken.push(format!(
                    "{} ({}) has no entry in {}",
                    function.id,
                    function.wording,
                    ledger::MAP_PATH
                ));
                &empty
            }
        };
        if mapping.ui.is_some() || mapping.outside.is_some() {
            if mapping.ui.is_some() {
                functions_ui_only += 1;
            } else {
                functions_deferred += 1;
            }
            function_rows.push(FunctionRow {
                id: function.id.clone(),
                area: function.area.clone(),
                function: function.wording.clone(),
                ui_only: mapping.ui.clone(),
                deferred: mapping.outside.clone().filter(|_| mapping.ui.is_none()),
                bug: None,
                gmail: None,
                outlook: None,
            });
            continue;
        }
        let mut cell = |provider: &'static str, applies: bool| {
            if !applies {
                if !mapping.on(provider).is_empty() {
                    broken.push(format!(
                        "{}: [{}] has a `{provider}` list, and the function is not one of \
                         {provider}",
                        ledger::MAP_PATH,
                        function.id
                    ));
                }
                return None;
            }
            if mapping.by.is_empty() && mapping.on(provider).is_empty() {
                broken.push(format!(
                    "{}: [{}] says nothing that shows the function performed on {provider}",
                    ledger::MAP_PATH,
                    function.id
                ));
            }
            // A known product bug keeps the function open whatever the
            // scenarios do: one that passes with the bug in shows nothing.
            if let Some(bug) = &mapping.bug {
                let reason = format!("known bug {bug}");
                return Some(cell_of(Status::Open, &[], Some(&reason)));
            }
            let performed: Vec<&Scenario> = scenarios
                .iter()
                .filter(|scenario| {
                    scenario.is_of(provider)
                        && performs(scenario, mapping, provider, reader, &by_entry)
                })
                .collect();
            let names: Vec<String> = performed.iter().map(|scenario| scenario.name()).collect();
            let checking: Vec<String> = names
                .iter()
                .filter(|name| checked.contains(&(function.id.as_str(), name.as_str())))
                .cloned()
                .collect();
            for (id, scenario) in &ledger.checks {
                if id == &function.id && checking.contains(scenario) {
                    used_checks.insert((id.as_str(), scenario.as_str()));
                }
            }
            let waiver = waived_functions
                .get(&(function.id.as_str(), provider))
                .copied();
            if !checking.is_empty() && waiver.is_some() {
                stale.push(format!(
                    "{}: {} is waived on {provider} and is covered",
                    ledger::WAIVERS_PATH,
                    function.id
                ));
            }
            let proving: Vec<&Proof> = proofs
                .iter()
                .copied()
                .filter(|proof| {
                    proof.function == function.id
                        && proof.provider == provider
                        && checking.contains(&proof.scenario)
                })
                .collect();
            for proof in &proving {
                used_proofs.insert((&proof.function, &proof.provider, &proof.scenario));
            }
            if let Some(proof) = proving.first() {
                let by: Vec<String> = proving.iter().map(|proof| proof.scenario.clone()).collect();
                Some(cell_of(Status::Proved, &by, Some(&proof.broke)))
            } else if !checking.is_empty() {
                Some(cell_of(Status::Claimed, &checking, None))
            } else if !names.is_empty() {
                Some(cell_of(Status::Performed, &names, None))
            } else if waiver.is_some() {
                Some(cell_of(Status::Waived, &names, waiver))
            } else {
                Some(cell_of(Status::Open, &names, None))
            }
        };
        let gmail = cell(GMAIL, function.gmail);
        let outlook = cell(OUTLOOK, function.outlook);
        functions_gmail.add(gmail.as_ref());
        functions_outlook.add(outlook.as_ref());
        function_rows.push(FunctionRow {
            id: function.id.clone(),
            area: function.area.clone(),
            function: function.wording.clone(),
            ui_only: None,
            deferred: None,
            bug: mapping.bug.clone(),
            gmail,
            outlook,
        });
    }
    // What is said of a function a known bug keeps open is not looked at.
    let has_bug = |id: &str| {
        ledger
            .map
            .functions
            .get(id)
            .is_some_and(|mapping| mapping.bug.is_some())
    };
    for proof in proofs {
        let used = used_proofs.contains(&(&proof.function, &proof.provider, &proof.scenario));
        if !used && !has_bug(&proof.function) {
            stale.push(format!(
                "{}: breaking the product is said to fail `{}` for {} on {}, and no record \
                 shows that scenario performing and checking the function there",
                ledger::PROOFS_PATH,
                proof.scenario,
                proof.function,
                proof.provider
            ));
        }
    }
    for (id, scenario) in &ledger.checks {
        if has_bug(id) {
            continue;
        }
        if !used_checks.contains(&(id.as_str(), scenario.as_str())) {
            stale.push(format!(
                "{}: `{scenario}` is said to check {id}, and no record shows it performing \
                 the function",
                ledger::CHECKS_PATH
            ));
        }
    }

    let mut unlisted: BTreeSet<String> = BTreeSet::new();
    for scenario in &scenarios {
        unlisted.extend(scenario.unlisted_requests());
        for call in &scenario.evidence.provider {
            if call.route.is_none() {
                unlisted.insert(format!(
                    "provider {}: {} {} (no API method of the emulator)",
                    call.provider,
                    call.method,
                    call.path.as_deref().unwrap_or_default()
                ));
            }
        }
    }

    Model {
        suite,
        functions_listed: ledger.functions.len(),
        functions_ui_only,
        functions_deferred,
        functions_gmail,
        functions_outlook,
        functions: function_rows,
        entry_points: entry_totals.into_values().collect(),
        entry_rows,
        dead_code,
        loops,
        unlisted: unlisted.into_iter().collect(),
        broken,
        stale,
    }
}

/// An entry point as the ledger names it.
fn entry(row: &Row) -> String {
    format!("{} {}", row.kind, row.key)
}

/// The providers a waiver is for.
fn applies(provider: Option<&str>) -> Vec<&'static str> {
    PROVIDERS
        .into_iter()
        .filter(|own| provider.is_none_or(|provider| provider == *own))
        .collect()
}

/// A waiver for a provider that is neither of the two applies to nothing.
fn unknown_provider(provider: Option<&str>) -> Option<&str> {
    provider.filter(|provider| !PROVIDERS.contains(provider))
}

/// Whether the scenario performed the function on `provider`: one of the
/// `by` requests, and everything the provider's list asks.
fn performs(
    scenario: &Scenario,
    mapping: &Mapping,
    provider: &str,
    reader: &Reader<'_>,
    by_entry: &BTreeMap<String, &Row>,
) -> bool {
    let seen = |atom: &Atom| {
        by_entry.get(&atom.entry()).is_some_and(|row| {
            scenario
                .hits(row, reader.sources)
                .iter()
                .any(|hit| atom.accepts(hit))
        })
    };
    (mapping.by.is_empty() || mapping.by.iter().any(seen)) && mapping.on(provider).iter().all(seen)
}

/// The cell of a row that stands at `status` because of the scenarios
/// `shown`.
fn cell_of(status: Status, shown: &[String], reason: Option<&str>) -> Cell {
    Cell {
        status,
        scenarios: shown.len(),
        examples: shown.iter().take(EXAMPLES).cloned().collect(),
        reason: reason.map(str::to_owned),
    }
}
