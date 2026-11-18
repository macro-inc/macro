//! Explicit host-facts input; no model listener, state writer or clock is installed.
use super::checklist_plan::{ChecklistCalendar, TaskInfo};
use lexical_model::{Command, CommandKey, Error, ExtensionCommand, Input, KeyEvent, ViewSelection};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc};

pub(crate) mod transport;

/// Actual external facts, shared by one configured session's derived planner.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChecklistFacts {
    /// Real provider properties indexed only for lookup.
    pub tasks: BTreeMap<String, TaskInfo>,
    /// Actual name map; never apply object-prototype lookup rules here.
    pub names: BTreeMap<String, String>,
    /// Raw host clock/parser observations, without native clock inference.
    pub calendar: ChecklistCalendar,
}

/// Typed command payload; revision identity does not grant graph authority.
#[derive(Clone, Debug)]
pub struct FactsRevision {
    pub(super) generation: u32,
    pub(super) version: u64,
    pub(super) rebind: bool,
    pub(super) facts: Arc<ChecklistFacts>,
}
static SET_FACTS: CommandKey<FactsRevision> = CommandKey::new("group-b.set-checklist-facts");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    facts_version: String,
    #[serde(default)]
    rebind: bool,
    tasks: BTreeMap<String, transport::RawTaskInfo>,
    names: BTreeMap<String, String>,
    calendar: transport::RawCalendar,
}

pub(super) fn decode(
    name: &str,
    json: &str,
    generation: u32,
    event: Option<&KeyEvent>,
) -> Result<Option<Command>, Error> {
    if name != SET_FACTS.name() {
        return Ok(None);
    }
    if event.is_some() {
        return Err(Error::Invariant(
            "checklist facts are not a keyboard command",
        ));
    }
    let request: Request = serde_json::from_str(json)?;
    let version = request
        .facts_version
        .parse::<u64>()
        .map_err(|_| Error::Invariant("checklist facts revision"))?;
    if version == 0 || version.to_string() != request.facts_version {
        return Err(Error::Invariant("checklist facts revision"));
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &SET_FACTS,
        FactsRevision {
            generation,
            version,
            rebind: request.rebind,
            facts: Arc::new(transport::into_facts(
                request.tasks,
                request.names,
                request.calendar,
            )),
        },
    ))))
}

/// Read only an actual issued static-key payload; selection intent is forbidden.
pub fn input_revision(input: &Input) -> Result<Option<&FactsRevision>, Error> {
    if let Input::Command {
        command: Command::Extension(command),
        selection,
    } = input
        && let Some(revision) = command.payload(&SET_FACTS)
    {
        if !matches!(selection, ViewSelection::KeepModel) {
            return Err(Error::Invariant("checklist facts selection"));
        }
        return Ok(Some(revision));
    }
    Ok(None)
}

/// Detect forbidden nesting before any batch member can affect the model.
pub fn contains_facts(input: &Input) -> bool {
    match input {
        Input::Batch(inputs) => inputs.iter().any(contains_facts),
        Input::Command {
            command: Command::Extension(command),
            ..
        } => command.payload(&SET_FACTS).is_some(),
        _ => false,
    }
}
