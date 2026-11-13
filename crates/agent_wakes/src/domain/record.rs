//! The wake record, version 1: the format muppet systems record an agent
//! invocation in (`agent-teammates/muppet/packages/lib/utilities/telemetry/record.ts`
//! is its source; `FORMAT.md` beside it describes it). Accepted unchanged:
//! fields this version doesn't name are dropped, as zod drops them.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// What kind of thing woke the agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    /// A schedule came due.
    Schedule,
    /// Someone wrote to the agent: chat, mail, a call.
    Message,
    /// Something happened in a system the agent watches.
    Event,
    /// A job the agent started changed or finished.
    Job,
    /// A person ran it by hand.
    Manual,
}

/// What woke the agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    /// What kind of thing woke it.
    pub kind: TriggerKind,
    /// The event source that fired, as the behavior names it.
    pub source: String,
    /// What within the source, when it has a name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The ids of what it is about, by what they identify, e.g. `pr`.
    pub ids: BTreeMap<String, String>,
    /// One line a person reads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Where the wake sits in an OpenTelemetry trace, as lower-case hex.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TraceIds {
    /// 32 hex characters.
    pub trace_id: String,
    /// 16 hex characters.
    pub span_id: String,
    /// The span of what started it, if anything.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
}

/// The wake, and its system, that started this one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeParent {
    /// The parent wake's id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wake: Option<String>,
    /// The parent wake's system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
}

/// The model session a wake ran as.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeSession {
    /// Claude Code's session id, Codex's conversation id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// What ran it, e.g. `claude` or `codex`.
    pub agent: String,
    /// Who serves the model, e.g. `anthropic`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// The model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// How a wake ended, apart from what came of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WakeEndStatus {
    /// It finished.
    Ok,
    /// It failed.
    Failed,
    /// It ran out of time.
    Timeout,
    /// It was stopped.
    Cancelled,
}

/// What went wrong.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WakeError {
    /// A low-cardinality name, e.g. `timeout`.
    #[serde(rename = "type")]
    pub kind: String,
    /// What happened.
    pub message: String,
}

/// Where an outcome's name came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum OutcomeSource {
    /// The agent's report.
    Reported,
    /// The effects the system saw.
    Observed,
    /// Neither.
    None,
}

/// How the agent's report held up against the effects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum OutcomeCheck {
    /// The effects confirm it.
    Confirmed,
    /// The outcome declares no evidence.
    Unverifiable,
    /// The effects say otherwise.
    Contradicted,
    /// The agent reported nothing.
    NotReported,
}

/// What came of a wake, and how that is known.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeOutcome {
    /// One of the system's declared outcomes, or `unclassified`.
    pub name: String,
    /// Where `name` came from.
    pub source: OutcomeSource,
    /// How the report held up.
    pub check: OutcomeCheck,
    /// What the agent reported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reported: Option<String>,
    /// What the effects alone imply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed: Option<String>,
    /// The agent's one line on what it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Something a wake did that its system saw for itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WakeEffect {
    /// What kind of effect, e.g. `pr_opened`.
    pub kind: String,
    /// Which one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// A link to it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// What the wake used.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeUsage {
    /// Input tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<f64>,
    /// Output tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<f64>,
    /// Cost in US dollars, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// Model turns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turns: Option<f64>,
}

/// The phase of a record: how far the wake had got when it was written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WakePhase {
    /// The wake began.
    Start,
    /// Its model session became known.
    Session,
    /// It is over.
    End,
}

/// What only an `end` record carries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeEnd {
    /// ISO 8601 in UTC.
    pub ended_at: String,
    /// How long it ran.
    pub duration_ms: f64,
    /// How it ended.
    pub status: WakeEndStatus,
    /// What went wrong, when it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<WakeError>,
    /// What came of it.
    pub outcome: WakeOutcome,
    /// What the system saw it do.
    pub effects: Vec<WakeEffect>,
    /// What it used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<WakeUsage>,
}

/// One wake record, version 1, as a muppet system sends it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WakeRecord {
    /// The format version; always 1.
    pub v: u8,
    /// `start`, `session`, or `end`.
    pub phase: WakePhase,
    /// The system that woke its agent, e.g. `pr-factory`.
    pub system: String,
    /// This wake's id, unique within the agent.
    pub wake: String,
    /// Where the wake sits in a trace.
    pub trace: TraceIds,
    /// `invoke_workflow` when no model was woken.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    /// What started it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<WakeParent>,
    /// What woke it.
    pub trigger: Trigger,
    /// ISO 8601 in UTC, to the millisecond.
    pub started_at: String,
    /// The model session it ran as.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<WakeSession>,
    /// The Herdr terminal it ran in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<String>,
    /// Present exactly when `phase` is `end`.
    #[serde(flatten, default, skip_serializing_if = "Option::is_none")]
    pub end: Option<WakeEnd>,
}
