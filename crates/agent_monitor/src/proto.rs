//! The generated wire types and the conversions between them and the domain
//! model. The wire shape differs from the domain on purpose: enums are `i32`,
//! times are Unix milliseconds, paths are strings, and fixed arrays are
//! repeated fields.

use std::path::PathBuf;

use chrono::DateTime;

use crate::domain::model::{
    ACTIVITY_MINUTES, Agent, AgentId, AgentKind, Cost, HOURS_PER_DAY, Progress, Severity, Snapshot,
    SourceHealth, SourceKind, SourceSet, SourceState, Status, TapeEvent, TapeKind, Timestamp,
    Tokens, Totals, TranscriptItem, TranscriptItemKind, Update, UpdateKind,
};

#[expect(
    missing_docs,
    clippy::large_enum_variant,
    reason = "tonic and prost output for proto/agent_monitor.proto"
)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/_includes.rs"));
}

/// The generated messages, enums, client and server of `macro.agent_monitor.v1`.
pub use generated::r#macro::agent_monitor::v1 as wire;

/// The wire protocol version. Bump it on any incompatible change to the proto.
pub const PROTOCOL: u32 = 1;

/// A wire message the domain cannot represent.
#[derive(Clone, Debug, thiserror::Error, PartialEq, Eq)]
pub enum WireError {
    /// A required field was missing.
    #[error("missing field `{0}`")]
    Missing(&'static str),
    /// An enum value this build does not know.
    #[error("unknown value {value} for `{field}`")]
    UnknownEnum {
        /// The field.
        field: &'static str,
        /// The value received.
        value: i32,
    },
    /// A timestamp out of range.
    #[error("timestamp out of range in `{0}`")]
    Timestamp(&'static str),
    /// A fixed-length series had the wrong length.
    #[error("`{field}` has {len} values")]
    SeriesLength {
        /// The field.
        field: &'static str,
        /// Its length.
        len: usize,
    },
}

fn to_ms(at: Timestamp) -> i64 {
    at.timestamp_millis()
}

fn from_ms(field: &'static str, ms: i64) -> Result<Timestamp, WireError> {
    DateTime::from_timestamp_millis(ms).ok_or(WireError::Timestamp(field))
}

fn from_ms_opt(field: &'static str, ms: Option<i64>) -> Result<Option<Timestamp>, WireError> {
    ms.map(|ms| from_ms(field, ms)).transpose()
}

fn path_to_wire(path: &Option<PathBuf>) -> Option<String> {
    path.as_ref()
        .map(|path| path.to_string_lossy().into_owned())
}

impl From<SourceKind> for wire::Source {
    fn from(source: SourceKind) -> Self {
        match source {
            SourceKind::Hc => Self::Hc,
            SourceKind::ClaudeRegistry => Self::ClaudeRegistry,
            SourceKind::ClaudeTranscripts => Self::ClaudeTranscripts,
            SourceKind::Codex => Self::Codex,
            SourceKind::Macrod => Self::Macrod,
            SourceKind::Manager => Self::Manager,
            SourceKind::RunRecord => Self::RunRecord,
            SourceKind::Demo => Self::Demo,
        }
    }
}

fn source_from_wire(value: i32) -> Result<SourceKind, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "source",
        value,
    };
    match wire::Source::try_from(value).map_err(|_| unknown.clone())? {
        wire::Source::Hc => Ok(SourceKind::Hc),
        wire::Source::ClaudeRegistry => Ok(SourceKind::ClaudeRegistry),
        wire::Source::ClaudeTranscripts => Ok(SourceKind::ClaudeTranscripts),
        wire::Source::Codex => Ok(SourceKind::Codex),
        wire::Source::Macrod => Ok(SourceKind::Macrod),
        wire::Source::Manager => Ok(SourceKind::Manager),
        wire::Source::RunRecord => Ok(SourceKind::RunRecord),
        wire::Source::Demo => Ok(SourceKind::Demo),
        wire::Source::Unspecified => Err(unknown),
    }
}

impl From<AgentKind> for wire::AgentKind {
    fn from(kind: AgentKind) -> Self {
        match kind {
            AgentKind::Manager => Self::Manager,
            AgentKind::Builder => Self::Builder,
            AgentKind::Explorer => Self::Explorer,
            AgentKind::Planner => Self::Planner,
            AgentKind::Chatter => Self::Chatter,
            AgentKind::Reviewer => Self::Reviewer,
            AgentKind::Subagent => Self::Subagent,
            AgentKind::MacrodSession => Self::MacrodSession,
            AgentKind::WorkRun => Self::WorkRun,
            AgentKind::Factory => Self::Factory,
            AgentKind::Shell => Self::Shell,
            AgentKind::Other => Self::Other,
        }
    }
}

fn kind_from_wire(value: i32) -> Result<AgentKind, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "kind",
        value,
    };
    match wire::AgentKind::try_from(value).map_err(|_| unknown.clone())? {
        wire::AgentKind::Manager => Ok(AgentKind::Manager),
        wire::AgentKind::Builder => Ok(AgentKind::Builder),
        wire::AgentKind::Explorer => Ok(AgentKind::Explorer),
        wire::AgentKind::Planner => Ok(AgentKind::Planner),
        wire::AgentKind::Chatter => Ok(AgentKind::Chatter),
        wire::AgentKind::Reviewer => Ok(AgentKind::Reviewer),
        wire::AgentKind::Subagent => Ok(AgentKind::Subagent),
        wire::AgentKind::MacrodSession => Ok(AgentKind::MacrodSession),
        wire::AgentKind::WorkRun => Ok(AgentKind::WorkRun),
        wire::AgentKind::Factory => Ok(AgentKind::Factory),
        wire::AgentKind::Shell => Ok(AgentKind::Shell),
        wire::AgentKind::Other => Ok(AgentKind::Other),
        wire::AgentKind::Unspecified => Err(unknown),
    }
}

impl From<Status> for wire::Status {
    fn from(status: Status) -> Self {
        match status {
            Status::Working => Self::Working,
            Status::Waiting => Self::Waiting,
            Status::Blocked => Self::Blocked,
            Status::Idle => Self::Idle,
            Status::Done => Self::Done,
            Status::Failed => Self::Failed,
            Status::Stopped => Self::Stopped,
        }
    }
}

fn status_from_wire(value: i32) -> Result<Status, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "status",
        value,
    };
    match wire::Status::try_from(value).map_err(|_| unknown.clone())? {
        wire::Status::Working => Ok(Status::Working),
        wire::Status::Waiting => Ok(Status::Waiting),
        wire::Status::Blocked => Ok(Status::Blocked),
        wire::Status::Idle => Ok(Status::Idle),
        wire::Status::Done => Ok(Status::Done),
        wire::Status::Failed => Ok(Status::Failed),
        wire::Status::Stopped => Ok(Status::Stopped),
        wire::Status::Unspecified => Err(unknown),
    }
}

impl From<Cost> for wire::Cost {
    fn from(cost: Cost) -> Self {
        let value = match cost {
            Cost::Known(usd) => wire::cost::Value::KnownUsd(usd),
            Cost::Estimated(usd) => wire::cost::Value::EstimatedUsd(usd),
            Cost::Unpriced => wire::cost::Value::Unpriced(wire::Unpriced {}),
        };
        Self { value: Some(value) }
    }
}

fn cost_from_wire(cost: Option<wire::Cost>) -> Cost {
    match cost.and_then(|cost| cost.value) {
        Some(wire::cost::Value::KnownUsd(usd)) => Cost::Known(usd),
        Some(wire::cost::Value::EstimatedUsd(usd)) => Cost::Estimated(usd),
        Some(wire::cost::Value::Unpriced(_)) | None => Cost::Unpriced,
    }
}

impl From<Tokens> for wire::Tokens {
    fn from(tokens: Tokens) -> Self {
        Self {
            input: tokens.input,
            output: tokens.output,
            cache_read: tokens.cache_read,
            cache_write: tokens.cache_write,
            cache_write_1h: tokens.cache_write_1h,
        }
    }
}

impl From<wire::Tokens> for Tokens {
    fn from(tokens: wire::Tokens) -> Self {
        Self {
            input: tokens.input,
            output: tokens.output,
            cache_read: tokens.cache_read,
            cache_write: tokens.cache_write,
            cache_write_1h: tokens.cache_write_1h,
        }
    }
}

impl From<&Agent> for wire::Agent {
    fn from(agent: &Agent) -> Self {
        Self {
            id: agent.id.as_str().to_owned(),
            sources: agent
                .sources
                .iter()
                .map(|source| wire::Source::from(source) as i32)
                .collect(),
            kind: wire::AgentKind::from(agent.kind) as i32,
            name: agent.name.clone(),
            task: agent.task.clone(),
            status: wire::Status::from(agent.status) as i32,
            status_detail: agent.status_detail.clone(),
            program: agent.program.clone(),
            model: agent.model.clone(),
            cwd: path_to_wire(&agent.cwd),
            branch: agent.branch.clone(),
            space: agent.space.clone(),
            tags: agent.tags.clone(),
            parent: agent.parent.as_ref().map(|id| id.as_str().to_owned()),
            children: agent
                .children
                .iter()
                .map(|id| id.as_str().to_owned())
                .collect(),
            terminal: agent.terminal.clone(),
            session: agent.session.clone(),
            transcript: path_to_wire(&agent.transcript),
            pid: agent.pid,
            started_ms: agent.started.map(to_ms),
            ended_ms: agent.ended.map(to_ms),
            last_activity_ms: agent.last_activity.map(to_ms),
            turns: agent.turns,
            tool_calls: agent.tool_calls,
            tool_errors: agent.tool_errors,
            doing: agent.doing.clone(),
            tokens: Some(agent.tokens.into()),
            cost: Some(agent.cost.into()),
            failures: agent.failures,
            activity: agent
                .activity
                .iter()
                .map(|count| u32::from(*count))
                .collect(),
        }
    }
}

impl TryFrom<wire::Agent> for Agent {
    type Error = WireError;

    fn try_from(agent: wire::Agent) -> Result<Self, WireError> {
        let sources = agent
            .sources
            .iter()
            .map(|source| source_from_wire(*source))
            .collect::<Result<SourceSet, WireError>>()?;
        let activity = series::<u16, ACTIVITY_MINUTES>(
            "activity",
            agent
                .activity
                .iter()
                .map(|count| u16::try_from(*count).unwrap_or(u16::MAX))
                .collect(),
        )?;

        Ok(Self {
            id: AgentId::from_wire(agent.id),
            sources,
            kind: kind_from_wire(agent.kind)?,
            name: agent.name,
            task: agent.task,
            status: status_from_wire(agent.status)?,
            status_detail: agent.status_detail,
            program: agent.program,
            model: agent.model,
            cwd: agent.cwd.map(PathBuf::from),
            branch: agent.branch,
            space: agent.space,
            tags: agent.tags,
            parent: agent.parent.map(AgentId::from_wire),
            children: agent.children.into_iter().map(AgentId::from_wire).collect(),
            terminal: agent.terminal,
            session: agent.session,
            transcript: agent.transcript.map(PathBuf::from),
            pid: agent.pid,
            started: from_ms_opt("started_ms", agent.started_ms)?,
            ended: from_ms_opt("ended_ms", agent.ended_ms)?,
            last_activity: from_ms_opt("last_activity_ms", agent.last_activity_ms)?,
            turns: agent.turns,
            tool_calls: agent.tool_calls,
            tool_errors: agent.tool_errors,
            doing: agent.doing,
            tokens: agent.tokens.map(Tokens::from).unwrap_or_default(),
            cost: cost_from_wire(agent.cost),
            failures: agent.failures,
            activity,
        })
    }
}

fn series<T, const N: usize>(field: &'static str, values: Vec<T>) -> Result<[T; N], WireError> {
    let len = values.len();
    values
        .try_into()
        .map_err(|_| WireError::SeriesLength { field, len })
}

impl From<TapeKind> for wire::TapeKind {
    fn from(kind: TapeKind) -> Self {
        match kind {
            TapeKind::Spawned => Self::Spawned,
            TapeKind::Status => Self::Status,
            TapeKind::TurnStart => Self::TurnStart,
            TapeKind::TurnEnd => Self::TurnEnd,
            TapeKind::ToolStart => Self::ToolStart,
            TapeKind::ToolEnd => Self::ToolEnd,
            TapeKind::ToolError => Self::ToolError,
            TapeKind::Failure => Self::Failure,
            TapeKind::Finished => Self::Finished,
            TapeKind::Removed => Self::Removed,
        }
    }
}

fn tape_kind_from_wire(value: i32) -> Result<TapeKind, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "tape kind",
        value,
    };
    match wire::TapeKind::try_from(value).map_err(|_| unknown.clone())? {
        wire::TapeKind::Spawned => Ok(TapeKind::Spawned),
        wire::TapeKind::Status => Ok(TapeKind::Status),
        wire::TapeKind::TurnStart => Ok(TapeKind::TurnStart),
        wire::TapeKind::TurnEnd => Ok(TapeKind::TurnEnd),
        wire::TapeKind::ToolStart => Ok(TapeKind::ToolStart),
        wire::TapeKind::ToolEnd => Ok(TapeKind::ToolEnd),
        wire::TapeKind::ToolError => Ok(TapeKind::ToolError),
        wire::TapeKind::Failure => Ok(TapeKind::Failure),
        wire::TapeKind::Finished => Ok(TapeKind::Finished),
        wire::TapeKind::Removed => Ok(TapeKind::Removed),
        wire::TapeKind::Unspecified => Err(unknown),
    }
}

impl From<Severity> for wire::Severity {
    fn from(severity: Severity) -> Self {
        match severity {
            Severity::Info => Self::Info,
            Severity::Notice => Self::Notice,
            Severity::Warning => Self::Warning,
            Severity::Error => Self::Error,
        }
    }
}

fn severity_from_wire(value: i32) -> Result<Severity, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "severity",
        value,
    };
    match wire::Severity::try_from(value).map_err(|_| unknown.clone())? {
        wire::Severity::Info => Ok(Severity::Info),
        wire::Severity::Notice => Ok(Severity::Notice),
        wire::Severity::Warning => Ok(Severity::Warning),
        wire::Severity::Error => Ok(Severity::Error),
        wire::Severity::Unspecified => Err(unknown),
    }
}

impl From<&TapeEvent> for wire::TapeEvent {
    fn from(event: &TapeEvent) -> Self {
        Self {
            seq: event.seq,
            at_ms: to_ms(event.at),
            agent_id: event.agent.as_str().to_owned(),
            kind: wire::TapeKind::from(event.kind) as i32,
            text: event.text.clone(),
            severity: wire::Severity::from(event.severity) as i32,
        }
    }
}

impl TryFrom<wire::TapeEvent> for TapeEvent {
    type Error = WireError;

    fn try_from(event: wire::TapeEvent) -> Result<Self, WireError> {
        Ok(Self {
            seq: event.seq,
            at: from_ms("at_ms", event.at_ms)?,
            agent: AgentId::from_wire(event.agent_id),
            kind: tape_kind_from_wire(event.kind)?,
            text: event.text,
            severity: severity_from_wire(event.severity)?,
        })
    }
}

impl From<&Totals> for wire::Totals {
    fn from(totals: &Totals) -> Self {
        Self {
            working: totals.working,
            waiting: totals.waiting,
            blocked: totals.blocked,
            failed_24h: totals.failed_24h,
            turns_24h: totals.turns_24h,
            tools_24h: totals.tools_24h,
            errors_24h: totals.errors_24h,
            cost_today: Some(totals.cost_today.into()),
            cost_by_hour: totals.cost_by_hour.to_vec(),
            tokens_per_min: totals.tokens_per_min.to_vec(),
        }
    }
}

impl TryFrom<wire::Totals> for Totals {
    type Error = WireError;

    fn try_from(totals: wire::Totals) -> Result<Self, WireError> {
        Ok(Self {
            working: totals.working,
            waiting: totals.waiting,
            blocked: totals.blocked,
            failed_24h: totals.failed_24h,
            turns_24h: totals.turns_24h,
            tools_24h: totals.tools_24h,
            errors_24h: totals.errors_24h,
            cost_today: cost_from_wire(totals.cost_today),
            cost_by_hour: series::<f32, HOURS_PER_DAY>("cost_by_hour", totals.cost_by_hour)?,
            tokens_per_min: series::<u32, ACTIVITY_MINUTES>(
                "tokens_per_min",
                totals.tokens_per_min,
            )?,
        })
    }
}

impl From<SourceState> for wire::SourceState {
    fn from(state: SourceState) -> Self {
        match state {
            SourceState::Starting => Self::Starting,
            SourceState::Healthy => Self::Healthy,
            SourceState::Unhealthy => Self::Unhealthy,
            SourceState::Absent => Self::Absent,
        }
    }
}

fn source_state_from_wire(value: i32) -> Result<SourceState, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "source state",
        value,
    };
    match wire::SourceState::try_from(value).map_err(|_| unknown.clone())? {
        wire::SourceState::Starting => Ok(SourceState::Starting),
        wire::SourceState::Healthy => Ok(SourceState::Healthy),
        wire::SourceState::Unhealthy => Ok(SourceState::Unhealthy),
        wire::SourceState::Absent => Ok(SourceState::Absent),
        wire::SourceState::Unspecified => Err(unknown),
    }
}

impl From<&SourceHealth> for wire::SourceHealth {
    fn from(health: &SourceHealth) -> Self {
        Self {
            source: wire::Source::from(health.source) as i32,
            state: wire::SourceState::from(health.state) as i32,
            detail: health.detail.clone(),
            items: health.items,
            last_event_ms: health.last_event.map(to_ms),
            indexing: health.indexing.map(|progress| wire::Progress {
                done: progress.done,
                total: progress.total,
            }),
            restarts: health.restarts,
        }
    }
}

impl TryFrom<wire::SourceHealth> for SourceHealth {
    type Error = WireError;

    fn try_from(health: wire::SourceHealth) -> Result<Self, WireError> {
        Ok(Self {
            source: source_from_wire(health.source)?,
            state: source_state_from_wire(health.state)?,
            detail: health.detail,
            items: health.items,
            last_event: from_ms_opt("last_event_ms", health.last_event_ms)?,
            indexing: health.indexing.map(|progress| Progress {
                done: progress.done,
                total: progress.total,
            }),
            restarts: health.restarts,
        })
    }
}

impl From<&Snapshot> for wire::Snapshot {
    fn from(snapshot: &Snapshot) -> Self {
        Self {
            agents: snapshot.agents.iter().map(Into::into).collect(),
            tape: snapshot.tape.iter().map(Into::into).collect(),
            totals: Some((&snapshot.totals).into()),
            sources: snapshot.sources.iter().map(Into::into).collect(),
        }
    }
}

impl TryFrom<wire::Snapshot> for Snapshot {
    type Error = WireError;

    fn try_from(snapshot: wire::Snapshot) -> Result<Self, WireError> {
        Ok(Self {
            agents: snapshot
                .agents
                .into_iter()
                .map(Agent::try_from)
                .collect::<Result<_, _>>()?,
            tape: snapshot
                .tape
                .into_iter()
                .map(TapeEvent::try_from)
                .collect::<Result<_, _>>()?,
            totals: snapshot
                .totals
                .ok_or(WireError::Missing("totals"))?
                .try_into()?,
            sources: snapshot
                .sources
                .into_iter()
                .map(SourceHealth::try_from)
                .collect::<Result<_, _>>()?,
        })
    }
}

impl From<&Update> for wire::Update {
    fn from(update: &Update) -> Self {
        let kind = match &update.kind {
            UpdateKind::Snapshot(snapshot) => wire::update::Kind::Snapshot(snapshot.into()),
            UpdateKind::Upsert(agent) => wire::update::Kind::Upsert(agent.into()),
            UpdateKind::Removed(id) => wire::update::Kind::Removed(id.as_str().to_owned()),
            UpdateKind::Event(event) => wire::update::Kind::Event(event.into()),
            UpdateKind::Totals(totals) => wire::update::Kind::Totals(totals.into()),
            UpdateKind::Source(health) => wire::update::Kind::Source(health.into()),
            UpdateKind::Heartbeat(at) => {
                wire::update::Kind::Heartbeat(wire::Heartbeat { at_ms: to_ms(*at) })
            }
        };
        Self {
            seq: update.seq,
            kind: Some(kind),
        }
    }
}

impl TryFrom<wire::Update> for Update {
    type Error = WireError;

    fn try_from(update: wire::Update) -> Result<Self, WireError> {
        let kind = match update.kind.ok_or(WireError::Missing("kind"))? {
            wire::update::Kind::Snapshot(snapshot) => UpdateKind::Snapshot(snapshot.try_into()?),
            wire::update::Kind::Upsert(agent) => UpdateKind::Upsert(agent.try_into()?),
            wire::update::Kind::Removed(id) => UpdateKind::Removed(AgentId::from_wire(id)),
            wire::update::Kind::Event(event) => UpdateKind::Event(event.try_into()?),
            wire::update::Kind::Totals(totals) => UpdateKind::Totals(totals.try_into()?),
            wire::update::Kind::Source(health) => UpdateKind::Source(health.try_into()?),
            wire::update::Kind::Heartbeat(heartbeat) => {
                UpdateKind::Heartbeat(from_ms("heartbeat", heartbeat.at_ms)?)
            }
        };
        Ok(Self {
            seq: update.seq,
            kind,
        })
    }
}

impl From<TranscriptItemKind> for wire::TranscriptItemKind {
    fn from(kind: TranscriptItemKind) -> Self {
        match kind {
            TranscriptItemKind::User => Self::User,
            TranscriptItemKind::Assistant => Self::Assistant,
            TranscriptItemKind::ToolCall => Self::ToolCall,
            TranscriptItemKind::ToolResult => Self::ToolResult,
        }
    }
}

fn transcript_kind_from_wire(value: i32) -> Result<TranscriptItemKind, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "transcript item kind",
        value,
    };
    match wire::TranscriptItemKind::try_from(value).map_err(|_| unknown.clone())? {
        wire::TranscriptItemKind::User => Ok(TranscriptItemKind::User),
        wire::TranscriptItemKind::Assistant => Ok(TranscriptItemKind::Assistant),
        wire::TranscriptItemKind::ToolCall => Ok(TranscriptItemKind::ToolCall),
        wire::TranscriptItemKind::ToolResult => Ok(TranscriptItemKind::ToolResult),
        wire::TranscriptItemKind::Unspecified => Err(unknown),
    }
}

impl From<&TranscriptItem> for wire::TranscriptItem {
    fn from(item: &TranscriptItem) -> Self {
        Self {
            at_ms: to_ms(item.at),
            kind: wire::TranscriptItemKind::from(item.kind) as i32,
            text: item.text.clone(),
            tool_id: item.tool_id.clone(),
            tool_name: item.tool_name.clone(),
            is_error: item.is_error,
            duration_ms: item.duration_ms,
        }
    }
}

impl TryFrom<wire::TranscriptItem> for TranscriptItem {
    type Error = WireError;

    fn try_from(item: wire::TranscriptItem) -> Result<Self, WireError> {
        Ok(Self {
            at: from_ms("at_ms", item.at_ms)?,
            kind: transcript_kind_from_wire(item.kind)?,
            text: item.text,
            tool_id: item.tool_id,
            tool_name: item.tool_name,
            is_error: item.is_error,
            duration_ms: item.duration_ms,
        })
    }
}
