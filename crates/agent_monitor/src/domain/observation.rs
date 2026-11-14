//! What sources send the store: source-shaped facts, never finished agents.
//!
//! The reducer joins facts into agents by the keys below (plan §3):
//!
//! | Join | Key |
//! | --- | --- |
//! | terminal ↔ Claude session | [`TerminalFact::foreground_pid`] = [`ClaudeSessionFact::pid`] → `session_id` |
//! | session ↔ transcript | [`ClaudeSessionFact::session_id`] = [`TranscriptKey::session`] |
//! | session ↔ subagents | [`TranscriptKey::subagent`] |
//! | terminal ↔ parent | [`TerminalFact::parent`], else [`TerminalFact::spawned_by`] |
//! | macrod session ↔ everything | [`MacrodSessionFact::native_id`] / `transcript`; [`TerminalFact::macrod_session`] |
//! | manager ↔ terminal | [`ManagerFact::dir`] = [`TerminalFact::manager_dir`] |
//! | work run ↔ terminal | [`RunRecordFact::id`] = [`TerminalFact::run_id`], or [`RunRecordFact::terminal`] |
//! | Codex terminal ↔ rollout | `cwd` plus start time |

use std::path::PathBuf;

use crate::domain::model::{AgentKind, Cost, SourceHealth, SourceKind, Timestamp, Tokens};

/// One message from a source to the store.
#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    /// Which source sent it.
    pub source: SourceKind,
    /// What changed.
    pub change: Change,
}

/// A change a source reports.
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    /// A fact appeared or changed. A [`Fact::Transcript`] appends to what the
    /// store already holds for that transcript.
    Upsert(Fact),
    /// A fact is gone.
    Remove(FactKey),
    /// Everything this source knows, replacing all it reported before. Sent
    /// first by every run, and again after a source loses events.
    Reset(Vec<Fact>),
    /// The source's health changed.
    Health(SourceHealth),
}

/// One source-shaped fact.
#[derive(Clone, Debug, PartialEq)]
pub enum Fact {
    /// An hc terminal.
    Terminal(Box<TerminalFact>),
    /// A running Claude Code process from the session registry.
    ClaudeSession(ClaudeSessionFact),
    /// New records in a Claude or Codex transcript.
    Transcript(TranscriptDelta),
    /// A session macrod dispatched.
    MacrodSession(MacrodSessionFact),
    /// A herdr manager directory.
    Manager(ManagerFact),
    /// A work-run record.
    RunRecord(RunRecordFact),
}

impl Fact {
    /// The key the store files this fact under.
    pub fn key(&self) -> FactKey {
        match self {
            Fact::Terminal(terminal) => FactKey::Terminal(terminal.address.clone()),
            Fact::ClaudeSession(session) => FactKey::ClaudeSession(session.pid),
            Fact::Transcript(delta) => FactKey::Transcript(delta.key.clone()),
            Fact::MacrodSession(session) => FactKey::MacrodSession(session.id.clone()),
            Fact::Manager(manager) => FactKey::Manager(manager.dir.clone()),
            Fact::RunRecord(record) => FactKey::RunRecord(record.id.clone()),
        }
    }
}

/// Identifies one fact within its source.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FactKey {
    /// An hc terminal address.
    Terminal(String),
    /// A Claude Code process id.
    ClaudeSession(u32),
    /// A transcript.
    Transcript(TranscriptKey),
    /// A macrod session id.
    MacrodSession(String),
    /// A manager directory.
    Manager(PathBuf),
    /// A work-run id.
    RunRecord(String),
}

/// Whether an hc terminal's process is still running.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TerminalState {
    /// Running.
    Live,
    /// Exited.
    Finished,
}

/// What an hc terminal reports its program is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TerminalActivity {
    /// Idle.
    Idle,
    /// Working.
    Working,
    /// Its turn finished.
    Done,
    /// Blocked, for example on a permission prompt.
    Blocked,
    /// Reported an error.
    Error,
}

/// Why an hc terminal finished.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum FinishReason {
    /// Its process exited on its own.
    Exited,
    /// Someone killed it.
    Killed,
    /// A restart stopped it.
    StoppedByRestart,
    /// Another reason, verbatim.
    Other(String),
}

/// An hc terminal. Label meanings are decoded by the hc adapter, so the
/// reducer never reads raw label names.
#[derive(Clone, Debug, PartialEq)]
pub struct TerminalFact {
    /// Terminal address.
    pub address: String,
    /// Display name.
    pub name: String,
    /// The parent terminal's address.
    pub parent: Option<String>,
    /// The address of the terminal that spawned this one, from labels.
    pub spawned_by: Option<String>,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Running or exited.
    pub state: TerminalState,
    /// What the program reports.
    pub activity: Option<TerminalActivity>,
    /// The program's status message.
    pub status_message: Option<String>,
    /// The terminal's turn counter.
    pub turn: Option<u32>,
    /// When it was created.
    pub created: Option<Timestamp>,
    /// When it finished.
    pub finished: Option<Timestamp>,
    /// Exit code, once finished.
    pub exit_code: Option<i32>,
    /// Why it finished.
    pub finish_reason: Option<FinishReason>,
    /// The foreground process id.
    pub foreground_pid: Option<u32>,
    /// The foreground program name.
    pub program: Option<String>,
    /// The agent kind, from labels.
    pub kind: Option<AgentKind>,
    /// The model, from labels.
    pub model: Option<String>,
    /// The herdr space.
    pub space: Option<String>,
    /// The goal, from labels.
    pub goal: Option<String>,
    /// Whether it is marked as waiting on a person.
    pub waiting: bool,
    /// The manager directory, from labels.
    pub manager_dir: Option<PathBuf>,
    /// The macrod session this terminal runs, from labels.
    pub macrod_session: Option<String>,
    /// The work-run id, from labels.
    pub run_id: Option<String>,
    /// herdr tags.
    pub tags: Vec<String>,
}

/// A running Claude Code process from the session registry.
#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeSessionFact {
    /// Process id.
    pub pid: u32,
    /// Session id; equals the transcript file stem.
    pub session_id: String,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Session name.
    pub name: Option<String>,
    /// Whether it is running a turn.
    pub busy: bool,
    /// When the registry entry was last written.
    pub updated: Option<Timestamp>,
}

/// Which program wrote a transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TranscriptProgram {
    /// Claude Code.
    Claude,
    /// Codex.
    Codex,
}

/// Identifies a transcript.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TranscriptKey {
    /// The program that wrote it.
    pub program: TranscriptProgram,
    /// The native session id.
    pub session: String,
    /// The subagent id, for a subagent's transcript inside a session.
    pub subagent: Option<String>,
}

/// New records in one transcript.
#[derive(Clone, Debug, PartialEq)]
pub struct TranscriptDelta {
    /// Which transcript.
    pub key: TranscriptKey,
    /// The file.
    pub path: PathBuf,
    /// The file was re-read from the start; drop what was counted before.
    pub from_start: bool,
    /// Working directory, when a record carries it.
    pub cwd: Option<PathBuf>,
    /// Git branch, when a record carries it.
    pub branch: Option<String>,
    /// Model, when a record carries it.
    pub model: Option<String>,
    /// Title, when a record carries it.
    pub title: Option<String>,
    /// The records, oldest first.
    pub events: Vec<TranscriptEvent>,
}

/// One countable record from a transcript.
#[derive(Clone, Debug, PartialEq)]
pub struct TranscriptEvent {
    /// When it was written.
    pub at: Timestamp,
    /// What it records.
    pub kind: TranscriptEventKind,
}

/// What a transcript record counts toward.
#[derive(Clone, Debug, PartialEq)]
pub enum TranscriptEventKind {
    /// A user prompt started a turn.
    TurnStart,
    /// The assistant finished a turn.
    TurnEnd,
    /// A tool call started.
    ToolStart {
        /// Tool call id.
        id: String,
        /// Tool name.
        name: String,
        /// A short gist of its target (a file name, a command's first word).
        gist: Option<String>,
    },
    /// A tool call returned.
    ToolEnd {
        /// Tool call id.
        id: String,
        /// Whether it failed.
        is_error: bool,
    },
    /// Token usage of one model response.
    Usage(Tokens),
    /// The cost the program itself reported, replacing any estimate.
    Cost(Cost),
}

/// A session macrod dispatched, from its session record.
#[derive(Clone, Debug, PartialEq)]
pub struct MacrodSessionFact {
    /// macrod's session id.
    pub id: String,
    /// The harness id.
    pub harness: String,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Model.
    pub model: Option<String>,
    /// The program's native session id.
    pub native_id: Option<String>,
    /// Transcript file.
    pub transcript: Option<PathBuf>,
    /// When it started.
    pub started: Option<Timestamp>,
}

/// A herdr manager directory.
#[derive(Clone, Debug, PartialEq)]
pub struct ManagerFact {
    /// The directory.
    pub dir: PathBuf,
    /// The goal's first line.
    pub goal: Option<String>,
    /// The manager's state word.
    pub state: Option<String>,
    /// Review verdicts written so far.
    pub reviews: u32,
    /// The last verdict.
    pub last_verdict: Option<String>,
}

/// A work-run record.
#[derive(Clone, Debug, PartialEq)]
pub struct RunRecordFact {
    /// Run id.
    pub id: String,
    /// The task.
    pub task: Option<String>,
    /// A label.
    pub label: Option<String>,
    /// The record's status word.
    pub status: Option<String>,
    /// When it started.
    pub started: Option<Timestamp>,
    /// Process id.
    pub pid: Option<u32>,
    /// The terminal running it.
    pub terminal: Option<String>,
    /// The run's cost file.
    pub cost: Option<Cost>,
}
