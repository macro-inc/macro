//! The checked-in files the report joins the evidence with: the list of
//! email functions, how the backend carries each out, which scenarios check
//! one, which a break in product code proved, and what is waived, deferred
//! or thought dead.

use std::collections::BTreeMap;
use std::path::Path;
use std::str::FromStr;

use rootcause::prelude::*;
use serde::Deserialize;

use super::seen::{Hit, scalar};
use crate::Kind;

/// The functions of email, shared with the web app's suite.
pub(crate) const FUNCTIONS_PATH: &str = "apps/web/tests/email-e2e/ledger/functions.tsv";
/// How the backend carries each function out.
pub(crate) const MAP_PATH: &str = "crates/email_e2e/coverage/functions.toml";
/// The scenarios that check a function's result.
pub(crate) const CHECKS_PATH: &str = "crates/email_e2e/coverage/checks.tsv";
/// What is left uncovered on purpose.
/// The breaks in product code that made a scenario fail.
pub(crate) const PROOFS_PATH: &str = "crates/email_e2e/coverage/proofs.tsv";
pub(crate) const WAIVERS_PATH: &str = "crates/email_e2e/coverage/waivers.toml";

const FUNCTIONS_HEADER: &str = "id\tarea\tfunction\tgmail\toutlook\tui\tresult_checked_at";
const CHECKS_HEADER: &str = "function\tscenario";
const PROOFS_HEADER: &str = "function\tprovider\tscenario\tbreak";
const YES: &str = "yes";
/// What the function list's provider columns say when it does not.
const NO: &str = "no";
/// The table of the map that is not a function: entry points that serve
/// none.
const PLUMBING: &str = "plumbing";

/// One function of email: something a user or the system does with mail.
#[derive(Clone, Debug)]
pub(crate) struct Function {
    pub(crate) id: String,
    pub(crate) area: String,
    pub(crate) wording: String,
    pub(crate) gmail: bool,
    pub(crate) outlook: bool,
}

/// How the backend carries one function out.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMapping {
    #[serde(default)]
    by: Vec<String>,
    #[serde(default)]
    gmail: Vec<String>,
    #[serde(default)]
    outlook: Vec<String>,
    #[serde(default)]
    also: Vec<String>,
    ui: Option<String>,
    outside: Option<String>,
    bug: Option<String>,
}

/// How the backend carries one function out, parsed.
#[derive(Debug, Default)]
pub(crate) struct Mapping {
    /// The function is performed when one of these is seen.
    pub(crate) by: Vec<Atom>,
    /// And, on a Gmail inbox, all of these.
    pub(crate) gmail: Vec<Atom>,
    /// And, on an Outlook inbox, all of these.
    pub(crate) outlook: Vec<Atom>,
    /// Entry points that take part without proving anything.
    pub(crate) also: Vec<Atom>,
    /// Why the backend has no part in the function, when it has none.
    pub(crate) ui: Option<String>,
    /// Which other service carries the function out, when no stack of the
    /// suite records it.
    pub(crate) outside: Option<String>,
    /// The known product bug that keeps the function open, when one does.
    pub(crate) bug: Option<String>,
}

impl Mapping {
    /// Every entry point the mapping names.
    pub(crate) fn atoms(&self) -> impl Iterator<Item = &Atom> {
        self.by
            .iter()
            .chain(&self.gmail)
            .chain(&self.outlook)
            .chain(&self.also)
    }

    /// What must also be seen on an inbox of `provider`.
    pub(crate) fn on(&self, provider: &str) -> &[Atom] {
        if provider == super::GMAIL {
            &self.gmail
        } else {
            &self.outlook
        }
    }
}

/// An entry point, with what its request must show.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Atom {
    pub(crate) kind: Kind,
    pub(crate) key: String,
    conditions: Vec<Condition>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Condition {
    /// `/pointer` or `/pointer=text`, in the body, message or variables.
    Pointer(String, Option<String>),
    /// `?key` or `?key=text`, in the query string.
    Query(String, Option<String>),
    /// `name=text`: a parameter of the route.
    Param(String, String),
    /// `~text`: in the text of a GraphQL query.
    Text(String),
}

impl Atom {
    /// The entry point as the list names it: `kind key`.
    pub(crate) fn entry(&self) -> String {
        format!("{} {}", self.kind, self.key)
    }

    /// Whether a request to the entry point shows what the atom asks.
    pub(crate) fn accepts(&self, hit: &Hit<'_>) -> bool {
        self.conditions.iter().all(|condition| match condition {
            Condition::Pointer(pointer, wanted) => hit
                .body
                .and_then(|body| body.pointer(pointer))
                .is_some_and(|found| {
                    wanted
                        .as_ref()
                        .is_none_or(|wanted| &scalar(found) == wanted)
                }),
            Condition::Query(key, wanted) => hit.query.split('&').any(|pair| {
                let (found, value) = pair.split_once('=').unwrap_or((pair, ""));
                found == key && wanted.as_ref().is_none_or(|wanted| value == wanted)
            }),
            Condition::Param(name, wanted) => hit
                .params
                .iter()
                .any(|(found, value)| found == name && value == wanted),
            Condition::Text(text) => hit.text.contains(text.as_str()),
        })
    }
}

impl FromStr for Atom {
    type Err = Report;

    fn from_str(text: &str) -> Result<Self, Report> {
        let (entry, conditions) = match text.split_once(" where ") {
            Some((entry, conditions)) => (entry, conditions),
            None => (text, ""),
        };
        let (kind, key) = entry
            .trim()
            .split_once(' ')
            .ok_or_else(|| report!("`{text}` is not `<kind> <key>`"))?;
        let kind =
            Kind::from_str(kind).map_err(|_| report!("`{text}` names no kind of entry point"))?;
        let conditions = conditions
            .split(',')
            .map(str::trim)
            .filter(|condition| !condition.is_empty())
            .map(|condition| {
                let (name, value) = match condition.split_once('=') {
                    Some((name, value)) => (name, Some(value.to_owned())),
                    None => (condition, None),
                };
                if let Some(text) = condition.strip_prefix('~') {
                    Ok(Condition::Text(text.to_owned()))
                } else if name.starts_with('/') {
                    Ok(Condition::Pointer(name.to_owned(), value))
                } else if let Some(key) = name.strip_prefix('?') {
                    Ok(Condition::Query(key.to_owned(), value))
                } else if let Some(value) = value {
                    Ok(Condition::Param(name.to_owned(), value))
                } else {
                    Err(report!("`{condition}` in `{text}` is no condition"))
                }
            })
            .collect::<Result<_, _>>()?;
        Ok(Self {
            kind,
            key: key.trim().to_owned(),
            conditions,
        })
    }
}

/// The map: every function's mapping, and the entry points that serve none.
#[derive(Debug, Default)]
pub(crate) struct Map {
    pub(crate) functions: BTreeMap<String, Mapping>,
    /// `kind key` to why it is no function.
    pub(crate) plumbing: BTreeMap<String, String>,
}

/// What is left uncovered on purpose, for good or until a later tier.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Waivers {
    #[serde(default)]
    pub(crate) entry_point: Vec<EntryWaiver>,
    #[serde(default)]
    pub(crate) function: Vec<FunctionWaiver>,
    /// Entry points left to the full-stack tier: not waived, not open.
    #[serde(default)]
    pub(crate) deferred: Vec<EntryWaiver>,
    /// Entry points nothing in the repository calls: waived, and listed as
    /// candidates for removal.
    #[serde(default)]
    pub(crate) dead_code: Vec<DeadCode>,
}

/// An entry point no scenario is asked to reach, or not yet.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EntryWaiver {
    /// `kind key`, as in the list.
    pub(crate) entry: String,
    /// `gmail` or `outlook`; both when absent.
    pub(crate) provider: Option<String>,
    pub(crate) reason: String,
}

/// An entry point with no caller in the repository.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeadCode {
    /// `kind key`, as in the list.
    pub(crate) entry: String,
    /// How it was found to have no caller.
    pub(crate) reason: String,
}

/// A break in product code that made a scenario fail on a provider: the
/// scenario does not pass without the function working.
#[derive(Clone, Debug)]
pub(crate) struct Proof {
    pub(crate) function: String,
    pub(crate) provider: String,
    pub(crate) scenario: String,
    /// What was broken in product code.
    pub(crate) broke: String,
}

/// A function no scenario is asked to cover.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FunctionWaiver {
    pub(crate) id: String,
    /// `gmail` or `outlook`; both when absent.
    pub(crate) provider: Option<String>,
    pub(crate) reason: String,
}

/// Everything checked in that the report reads.
pub(crate) struct Ledger {
    pub(crate) functions: Vec<Function>,
    pub(crate) map: Map,
    /// (function id, scenario) pairs: the scenario checks the function's
    /// result.
    pub(crate) checks: Vec<(String, String)>,
    pub(crate) proofs: Vec<Proof>,
    pub(crate) waivers: Waivers,
}

impl Ledger {
    /// Reads the ledger of the repository at `root`.
    pub(crate) fn load(root: &Path) -> Result<Self, Report> {
        Ok(Self {
            functions: functions(&read(root, FUNCTIONS_PATH)?)?,
            map: map(&read(root, MAP_PATH)?)?,
            checks: checks(&read(root, CHECKS_PATH)?)?,
            proofs: proofs(&read(root, PROOFS_PATH)?)?,
            waivers: toml::from_str(&read(root, WAIVERS_PATH)?)
                .context(format!("{WAIVERS_PATH} does not parse"))?,
        })
    }
}

fn read(root: &Path, path: &str) -> Result<String, Report> {
    Ok(std::fs::read_to_string(root.join(path)).context(format!("could not read {path}"))?)
}

/// The rows of a tab-separated file after its `header`, without comments.
fn rows<'a>(text: &'a str, header: &str, path: &str) -> Result<Vec<Vec<&'a str>>, Report> {
    let mut lines = text
        .lines()
        .filter(|line| !line.starts_with('#') && !line.trim().is_empty());
    if lines.next() != Some(header) {
        bail!("{path}: the first line is not the column header `{header}`");
    }
    Ok(lines.map(|line| line.split('\t').collect()).collect())
}

pub(crate) fn functions(text: &str) -> Result<Vec<Function>, Report> {
    rows(text, FUNCTIONS_HEADER, FUNCTIONS_PATH)?
        .into_iter()
        .map(|columns| {
            let [id, area, wording, gmail, outlook, _ui, _checked_at] = columns[..] else {
                bail!(
                    "{FUNCTIONS_PATH}: a row has {} columns, not 7",
                    columns.len()
                );
            };
            let applies = |value: &str| match value {
                YES => Ok(true),
                NO => Ok(false),
                other => Err(report!(
                    "{FUNCTIONS_PATH}: {id} says `{other}` for a provider, not {YES} or {NO}"
                )),
            };
            Ok(Function {
                id: id.to_owned(),
                area: area.to_owned(),
                wording: wording.to_owned(),
                gmail: applies(gmail)?,
                outlook: applies(outlook)?,
            })
        })
        .collect()
}

pub(crate) fn map(text: &str) -> Result<Map, Report> {
    let tables: BTreeMap<String, toml::Value> =
        toml::from_str(text).context(format!("{MAP_PATH} does not parse"))?;
    let mut map = Map::default();
    for (name, table) in tables {
        if name == PLUMBING {
            map.plumbing = table.try_into().context(format!(
                "{MAP_PATH}: [{PLUMBING}] is not entry points with reasons"
            ))?;
            continue;
        }
        let raw: RawMapping = table
            .try_into()
            .context(format!("{MAP_PATH}: [{name}] does not parse"))?;
        let atoms = |texts: &[String]| -> Result<Vec<Atom>, Report> {
            texts
                .iter()
                .map(|text| {
                    Ok(text
                        .parse::<Atom>()
                        .context(format!("{MAP_PATH}: [{name}]"))?)
                })
                .collect()
        };
        let mapping = Mapping {
            by: atoms(&raw.by)?,
            gmail: atoms(&raw.gmail)?,
            outlook: atoms(&raw.outlook)?,
            also: atoms(&raw.also)?,
            ui: raw.ui,
            outside: raw.outside,
            bug: raw.bug,
        };
        map.functions.insert(name, mapping);
    }
    Ok(map)
}

pub(crate) fn checks(text: &str) -> Result<Vec<(String, String)>, Report> {
    rows(text, CHECKS_HEADER, CHECKS_PATH)?
        .into_iter()
        .map(|columns| {
            let [function, scenario] = columns[..] else {
                bail!("{CHECKS_PATH}: a row has {} columns, not 2", columns.len());
            };
            Ok((function.to_owned(), scenario.to_owned()))
        })
        .collect()
}

pub(crate) fn proofs(text: &str) -> Result<Vec<Proof>, Report> {
    rows(text, PROOFS_HEADER, PROOFS_PATH)?
        .into_iter()
        .map(|columns| {
            let [function, provider, scenario, broken] = columns[..] else {
                bail!("{PROOFS_PATH}: a row has {} columns, not 4", columns.len());
            };
            if broken.trim().is_empty() {
                bail!("{PROOFS_PATH}: the proof of {function} does not say what was broken");
            }
            Ok(Proof {
                function: function.to_owned(),
                provider: provider.to_owned(),
                scenario: scenario.to_owned(),
                broke: broken.to_owned(),
            })
        })
        .collect()
}
