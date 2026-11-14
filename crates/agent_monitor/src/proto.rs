//! The generated wire types and the conversions between them and the domain
//! model. The wire shape differs from the domain on purpose: enums are `i32`,
//! times are Unix milliseconds, paths are strings, and fixed arrays are
//! repeated fields.

use std::path::PathBuf;

use chrono::DateTime;

use crate::domain::model::{
    ACTIVITY_MINUTES, Agent, AgentId, AgentKind, AgentMinutes, CiState, Cost, HOURS_PER_DAY,
    Mergeable, Pr, PrId, PrState, Progress, RepoName, ReviewState, Severity, Snapshot,
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
pub const PROTOCOL: u32 = 2;

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
    /// A repository name that is not `<owner>/<name>`.
    #[error("invalid repository `{0}`")]
    Repo(String),
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
            SourceKind::Daemon => Self::Daemon,
            SourceKind::Github => Self::Github,
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
        wire::Source::Daemon => Ok(SourceKind::Daemon),
        wire::Source::Github => Ok(SourceKind::Github),
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
            minutes: (!agent.minutes.is_empty()).then(|| agent.minutes.as_ref().into()),
            prs: agent.prs.iter().map(|id| id.as_str().to_owned()).collect(),
        }
    }
}

impl From<&AgentMinutes> for wire::AgentMinutes {
    fn from(minutes: &AgentMinutes) -> Self {
        let widen = |series: &[u16]| series.iter().map(|count| u32::from(*count)).collect();
        Self {
            turns: widen(&minutes.turns),
            tools: widen(&minutes.tools),
            errors: widen(&minutes.errors),
            tokens: minutes.tokens.to_vec(),
            cost_usd: minutes.cost_usd.to_vec(),
        }
    }
}

impl TryFrom<wire::AgentMinutes> for AgentMinutes {
    type Error = WireError;

    fn try_from(minutes: wire::AgentMinutes) -> Result<Self, WireError> {
        let narrow = |field: &'static str, values: Vec<u32>| {
            series::<u16, ACTIVITY_MINUTES>(
                field,
                values
                    .into_iter()
                    .map(|count| u16::try_from(count).unwrap_or(u16::MAX))
                    .collect(),
            )
        };
        Ok(Self {
            turns: narrow("minutes.turns", minutes.turns)?,
            tools: narrow("minutes.tools", minutes.tools)?,
            errors: narrow("minutes.errors", minutes.errors)?,
            tokens: series::<u32, ACTIVITY_MINUTES>("minutes.tokens", minutes.tokens)?,
            cost_usd: series::<f32, ACTIVITY_MINUTES>("minutes.cost_usd", minutes.cost_usd)?,
        })
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
            minutes: agent
                .minutes
                .map(AgentMinutes::try_from)
                .transpose()?
                .map(Box::new)
                .unwrap_or_default(),
            prs: agent.prs.into_iter().map(PrId::from_wire).collect(),
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
            TapeKind::PrOpened => Self::PrOpened,
            TapeKind::PrCiPassed => Self::PrCiPassed,
            TapeKind::PrCiFailed => Self::PrCiFailed,
            TapeKind::PrMerged => Self::PrMerged,
            TapeKind::PrClosed => Self::PrClosed,
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
        wire::TapeKind::PrOpened => Ok(TapeKind::PrOpened),
        wire::TapeKind::PrCiPassed => Ok(TapeKind::PrCiPassed),
        wire::TapeKind::PrCiFailed => Ok(TapeKind::PrCiFailed),
        wire::TapeKind::PrMerged => Ok(TapeKind::PrMerged),
        wire::TapeKind::PrClosed => Ok(TapeKind::PrClosed),
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
            spend_by_kind: totals
                .spend_by_kind
                .iter()
                .map(|(kind, usd)| wire::KindSpend {
                    kind: wire::AgentKind::from(*kind) as i32,
                    usd: *usd,
                })
                .collect(),
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
            spend_by_kind: totals
                .spend_by_kind
                .into_iter()
                .map(|spend| Ok((kind_from_wire(spend.kind)?, spend.usd)))
                .collect::<Result<_, WireError>>()?,
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
            poll_secs: health
                .poll_every
                .map(|every| u32::try_from(every.as_secs()).unwrap_or(u32::MAX)),
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
            poll_every: health
                .poll_secs
                .map(|secs| std::time::Duration::from_secs(u64::from(secs))),
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
            prs: snapshot.prs.iter().map(Into::into).collect(),
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
            prs: snapshot
                .prs
                .into_iter()
                .map(Pr::try_from)
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
            UpdateKind::PrUpsert(pr) => wire::update::Kind::PrUpsert(pr.into()),
            UpdateKind::PrRemoved(id) => wire::update::Kind::PrRemoved(id.as_str().to_owned()),
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
            wire::update::Kind::PrUpsert(pr) => UpdateKind::PrUpsert(pr.try_into()?),
            wire::update::Kind::PrRemoved(id) => UpdateKind::PrRemoved(PrId::from_wire(id)),
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

impl From<PrState> for wire::PrState {
    fn from(state: PrState) -> Self {
        match state {
            PrState::Unknown => Self::Unknown,
            PrState::Open => Self::Open,
            PrState::Draft => Self::Draft,
            PrState::Merged => Self::Merged,
            PrState::Closed => Self::Closed,
        }
    }
}

fn pr_state_from_wire(value: i32) -> Result<PrState, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "pr state",
        value,
    };
    match wire::PrState::try_from(value).map_err(|_| unknown.clone())? {
        wire::PrState::Unknown => Ok(PrState::Unknown),
        wire::PrState::Open => Ok(PrState::Open),
        wire::PrState::Draft => Ok(PrState::Draft),
        wire::PrState::Merged => Ok(PrState::Merged),
        wire::PrState::Closed => Ok(PrState::Closed),
        wire::PrState::Unspecified => Err(unknown),
    }
}

impl From<CiState> for wire::CiState {
    fn from(state: CiState) -> Self {
        match state {
            CiState::Unknown => Self::Unknown,
            CiState::None => Self::None,
            CiState::Running => Self::Running,
            CiState::Passed => Self::Passed,
            CiState::Failed => Self::Failed,
        }
    }
}

fn ci_state_from_wire(value: i32) -> Result<CiState, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "ci state",
        value,
    };
    match wire::CiState::try_from(value).map_err(|_| unknown.clone())? {
        wire::CiState::Unknown => Ok(CiState::Unknown),
        wire::CiState::None => Ok(CiState::None),
        wire::CiState::Running => Ok(CiState::Running),
        wire::CiState::Passed => Ok(CiState::Passed),
        wire::CiState::Failed => Ok(CiState::Failed),
        wire::CiState::Unspecified => Err(unknown),
    }
}

impl From<ReviewState> for wire::ReviewState {
    fn from(state: ReviewState) -> Self {
        match state {
            ReviewState::None => Self::None,
            ReviewState::ReviewRequired => Self::ReviewRequired,
            ReviewState::ChangesRequested => Self::ChangesRequested,
            ReviewState::Approved => Self::Approved,
        }
    }
}

fn review_state_from_wire(value: i32) -> Result<ReviewState, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "review state",
        value,
    };
    match wire::ReviewState::try_from(value).map_err(|_| unknown.clone())? {
        wire::ReviewState::None => Ok(ReviewState::None),
        wire::ReviewState::ReviewRequired => Ok(ReviewState::ReviewRequired),
        wire::ReviewState::ChangesRequested => Ok(ReviewState::ChangesRequested),
        wire::ReviewState::Approved => Ok(ReviewState::Approved),
        wire::ReviewState::Unspecified => Err(unknown),
    }
}

impl From<Mergeable> for wire::Mergeable {
    fn from(mergeable: Mergeable) -> Self {
        match mergeable {
            Mergeable::Unknown => Self::Unknown,
            Mergeable::Mergeable => Self::Mergeable,
            Mergeable::Conflicting => Self::Conflicting,
        }
    }
}

fn mergeable_from_wire(value: i32) -> Result<Mergeable, WireError> {
    let unknown = WireError::UnknownEnum {
        field: "mergeable",
        value,
    };
    match wire::Mergeable::try_from(value).map_err(|_| unknown.clone())? {
        wire::Mergeable::Unknown => Ok(Mergeable::Unknown),
        wire::Mergeable::Mergeable => Ok(Mergeable::Mergeable),
        wire::Mergeable::Conflicting => Ok(Mergeable::Conflicting),
        wire::Mergeable::Unspecified => Err(unknown),
    }
}

impl From<&Pr> for wire::PullRequest {
    fn from(pr: &Pr) -> Self {
        Self {
            id: pr.id.as_str().to_owned(),
            repo: pr.repo.as_str().to_owned(),
            number: pr.number,
            url: pr.url.clone(),
            title: pr.title.clone(),
            state: wire::PrState::from(pr.state) as i32,
            ci: wire::CiState::from(pr.ci) as i32,
            review: wire::ReviewState::from(pr.review) as i32,
            mergeable: wire::Mergeable::from(pr.mergeable) as i32,
            author_agent: pr.author_agent.as_ref().map(|id| id.as_str().to_owned()),
            agents: pr.agents.iter().map(|id| id.as_str().to_owned()).collect(),
            branch: pr.branch.clone(),
            opened_at_ms: pr.opened_at.map(to_ms),
            updated_at_ms: pr.updated_at.map(to_ms),
            closed_at_ms: pr.closed_at.map(to_ms),
        }
    }
}

impl TryFrom<wire::PullRequest> for Pr {
    type Error = WireError;

    fn try_from(pr: wire::PullRequest) -> Result<Self, WireError> {
        Ok(Self {
            id: PrId::from_wire(pr.id),
            repo: RepoName::parse(&pr.repo).ok_or_else(|| WireError::Repo(pr.repo.clone()))?,
            number: pr.number,
            url: pr.url,
            title: pr.title,
            state: pr_state_from_wire(pr.state)?,
            ci: ci_state_from_wire(pr.ci)?,
            review: review_state_from_wire(pr.review)?,
            mergeable: mergeable_from_wire(pr.mergeable)?,
            author_agent: pr.author_agent.map(AgentId::from_wire),
            agents: pr.agents.into_iter().map(AgentId::from_wire).collect(),
            branch: pr.branch,
            opened_at: from_ms_opt("opened_at_ms", pr.opened_at_ms)?,
            updated_at: from_ms_opt("updated_at_ms", pr.updated_at_ms)?,
            closed_at: from_ms_opt("closed_at_ms", pr.closed_at_ms)?,
        })
    }
}
