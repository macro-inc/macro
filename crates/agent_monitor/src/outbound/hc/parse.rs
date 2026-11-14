//! Decoding `hc events --json` lines, leniently: unknown fields and event
//! types are ignored, and every terminal field is optional.

use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::DateTime;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::domain::model::{AgentKind, Timestamp};
use crate::domain::observation::{
    Change, Fact, FactKey, FinishReason, TerminalActivity, TerminalFact, TerminalState,
};

/// Label names hc and herdr use.
const LABEL_KIND: &str = "herdr.kind";
const LABEL_MODEL: &str = "herdr.model";
const LABEL_SPACE: &str = "herdr.space";
const LABEL_GOAL: &str = "herdr.goal";
const LABEL_WAITING: &str = "herdr.waiting";
const LABEL_SPAWNED_BY: &str = "herdr.spawned-by";
const LABEL_MANAGER_DIR: &str = "herdr.manager-dir";
const LABEL_TAG: &str = "herdr.tag";

/// Program names that mean the terminal runs a shell, not an agent.
const SHELLS: &[&str] = &["bash", "zsh", "sh", "fish", "dash", "nu"];

/// Labels whose names depend on the machine, so they come from config.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HcLabels {
    /// Labels that carry a work-run id, checked in order.
    pub run_id: Vec<String>,
}

/// One line of the feed.
#[derive(Debug)]
pub(super) enum Line {
    /// Every terminal, replacing what was known.
    Snapshot(Vec<Map<String, Value>>),
    /// One fact change.
    Event(Event),
    /// The reader lagged; a snapshot follows.
    Missed,
    /// The feed is alive.
    Heartbeat,
    /// Anything else, including lines that do not parse.
    Other,
}

/// One fact change on one terminal.
#[derive(Debug, Deserialize)]
pub(super) struct Event {
    terminal: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    data: Value,
}

#[derive(Deserialize)]
struct RawLine {
    method: Option<String>,
    params: Option<Value>,
    terminals: Option<Vec<Map<String, Value>>>,
}

pub(super) fn line(text: &str) -> Line {
    let Ok(raw) = serde_json::from_str::<RawLine>(text) else {
        return Line::Other;
    };
    if let Some(terminals) = raw.terminals {
        return Line::Snapshot(terminals);
    }

    match raw.method.as_deref() {
        Some("event") => raw
            .params
            .and_then(|params| serde_json::from_value(params).ok())
            .map_or(Line::Other, Line::Event),
        Some("missed") => Line::Missed,
        Some("heartbeat") => Line::Heartbeat,
        _ => Line::Other,
    }
}

/// An event named a terminal the snapshot did not hold; start over.
#[derive(Debug)]
pub(super) struct UnknownTerminal;

/// Every terminal as hc last described it, kept raw so an event can patch it.
#[derive(Debug, Default)]
pub(super) struct Terminals(BTreeMap<String, Map<String, Value>>);

impl Terminals {
    pub fn from_snapshot(snapshot: Vec<Map<String, Value>>) -> Self {
        let terminals = snapshot
            .into_iter()
            .filter_map(|terminal| {
                let address = terminal.get("address")?.as_str()?.to_owned();
                Some((address, terminal))
            })
            .collect();
        Self(terminals)
    }

    pub fn facts(&self, labels: &HcLabels) -> Vec<Fact> {
        self.0
            .values()
            .filter_map(|terminal| decode(terminal, labels))
            .map(|terminal| Fact::Terminal(Box::new(terminal)))
            .collect()
    }

    /// Applies one event and returns the change to report, if any.
    pub fn apply(
        &mut self,
        event: Event,
        labels: &HcLabels,
    ) -> Result<Option<Change>, UnknownTerminal> {
        match event.kind.as_str() {
            "created" => {
                let Value::Object(terminal) = event.data else {
                    return Err(UnknownTerminal);
                };
                self.0.insert(event.terminal.clone(), terminal);
            }
            "removed" => {
                return Ok(self
                    .0
                    .remove(&event.terminal)
                    .map(|_| Change::Remove(FactKey::Terminal(event.terminal))));
            }
            kind => {
                let terminal = self.0.get_mut(&event.terminal).ok_or(UnknownTerminal)?;
                patch(terminal, kind, event.data);
            }
        }

        Ok(self
            .0
            .get(&event.terminal)
            .and_then(|terminal| decode(terminal, labels))
            .map(|terminal| Change::Upsert(Fact::Terminal(Box::new(terminal)))))
    }
}

/// Patches a terminal with one event's data. Most events carry terminal
/// fields by name; `foreground` carries the foreground object itself, and
/// `turn` carries the status state under `state`, which on a terminal means
/// live or finished.
fn patch(terminal: &mut Map<String, Value>, kind: &str, data: Value) {
    match (kind, data) {
        ("foreground", data) => {
            terminal.insert("foreground".to_owned(), data);
        }
        ("turn", Value::Object(mut data)) => {
            if let Some(state) = data.remove("state") {
                let status = terminal
                    .entry("status")
                    .or_insert_with(|| Value::Object(Map::new()));
                if !status.is_object() {
                    *status = Value::Object(Map::new());
                }
                if let Value::Object(status) = status {
                    status.insert("state".to_owned(), state);
                }
            }
            terminal.extend(data);
        }
        ("finished", Value::Object(data)) => {
            terminal.extend(data);
            terminal.insert("state".to_owned(), Value::from("finished"));
        }
        (_, Value::Object(mut data)) => {
            // Never let an unknown event's `state` flip live and finished.
            data.remove("state");
            terminal.extend(data);
        }
        _ => {}
    }
}

#[derive(Deserialize)]
struct RawTerminal {
    address: String,
    name: Option<String>,
    title: Option<String>,
    parent: Option<String>,
    cwd: Option<PathBuf>,
    state: Option<String>,
    status: Option<RawStatus>,
    turn: Option<u32>,
    created_ms: Option<i64>,
    finished_ms: Option<i64>,
    exit_code: Option<i32>,
    reason: Option<String>,
    foreground: Option<RawForeground>,
    #[serde(default)]
    labels: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
struct RawStatus {
    state: Option<String>,
    app: Option<String>,
    msg: Option<String>,
}

#[derive(Deserialize)]
struct RawForeground {
    pid: Option<u32>,
    name: Option<String>,
}

fn decode(terminal: &Map<String, Value>, labels: &HcLabels) -> Option<TerminalFact> {
    let raw: RawTerminal = serde_json::from_value(Value::Object(terminal.clone()))
        .inspect_err(|error| tracing::debug!(error = %error, "undecodable hc terminal"))
        .ok()?;
    let label = |name: &str| {
        raw.labels
            .get(name)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };

    let status = raw.status.as_ref();
    let program = status
        .and_then(|status| status.app.clone())
        .or_else(|| raw.foreground.as_ref().and_then(|fg| fg.name.as_deref()).map(program_name));
    let kind = label(LABEL_KIND).and_then(|kind| agent_kind(&kind)).or_else(|| {
        program
            .as_deref()
            .filter(|program| SHELLS.contains(program))
            .map(|_| AgentKind::Shell)
    });
    let name = raw
        .name
        .clone()
        .or_else(|| raw.title.clone())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| raw.address.clone());

    Some(TerminalFact {
        name,
        parent: raw.parent.clone(),
        spawned_by: label(LABEL_SPAWNED_BY),
        cwd: raw.cwd.clone(),
        state: match raw.state.as_deref() {
            Some("finished") => TerminalState::Finished,
            _ => TerminalState::Live,
        },
        activity: status
            .and_then(|status| status.state.as_deref())
            .and_then(activity),
        status_message: status.and_then(|status| status.msg.clone()),
        turn: raw.turn,
        created: raw.created_ms.and_then(from_millis),
        finished: raw.finished_ms.and_then(from_millis),
        exit_code: raw.exit_code,
        finish_reason: raw.reason.as_deref().map(finish_reason),
        foreground_pid: raw.foreground.as_ref().and_then(|fg| fg.pid),
        program,
        kind,
        model: label(LABEL_MODEL),
        space: label(LABEL_SPACE),
        goal: label(LABEL_GOAL),
        waiting: label(LABEL_WAITING).is_some(),
        manager_dir: label(LABEL_MANAGER_DIR).map(PathBuf::from),
        // No label names the macrod session a terminal runs; the reducer
        // joins those through the native session id instead.
        macrod_session: None,
        run_id: labels.run_id.iter().find_map(|name| label(name)),
        tags: label(LABEL_TAG)
            .map(|tags| {
                tags.split(',')
                    .map(str::trim)
                    .filter(|tag| !tag.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        address: raw.address,
    })
}

/// A foreground process name as a program: `.claude-wrapped` (a Nix wrapper)
/// is Claude Code.
fn program_name(name: &str) -> String {
    let name = name.trim_start_matches('.');
    let name = name.strip_suffix("-wrapped").unwrap_or(name);
    match name {
        "claude" => "claude-code".to_owned(),
        other => other.to_owned(),
    }
}

fn agent_kind(label: &str) -> Option<AgentKind> {
    match label {
        "manager" => Some(AgentKind::Manager),
        "builder" => Some(AgentKind::Builder),
        "explorer" => Some(AgentKind::Explorer),
        "planner" => Some(AgentKind::Planner),
        "chatter" => Some(AgentKind::Chatter),
        "reviewer" => Some(AgentKind::Reviewer),
        _ => None,
    }
}

fn activity(state: &str) -> Option<TerminalActivity> {
    match state {
        "idle" => Some(TerminalActivity::Idle),
        "working" => Some(TerminalActivity::Working),
        "done" => Some(TerminalActivity::Done),
        "blocked" => Some(TerminalActivity::Blocked),
        "error" => Some(TerminalActivity::Error),
        _ => None,
    }
}

fn finish_reason(reason: &str) -> FinishReason {
    match reason {
        "exited" => FinishReason::Exited,
        "killed" => FinishReason::Killed,
        "stopped_by_restart" => FinishReason::StoppedByRestart,
        other => FinishReason::Other(other.to_owned()),
    }
}

fn from_millis(millis: i64) -> Option<Timestamp> {
    DateTime::from_timestamp_millis(millis)
}
