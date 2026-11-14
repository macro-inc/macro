//! The normalized agent model every source is reduced into, and the updates the
//! store publishes. Only the store's reducer builds an [`Agent`]; sources send
//! [`Observation`](crate::domain::observation::Observation)s.

use std::fmt;
use std::path::PathBuf;

use chrono::{DateTime, Utc};

/// A point in time, always UTC.
pub type Timestamp = DateTime<Utc>;

/// Minutes in the per-agent activity sparkline and the tokens-per-minute series.
pub const ACTIVITY_MINUTES: usize = 60;

/// Hours in the cost-by-hour series.
pub const HOURS_PER_DAY: usize = 24;

/// A stable agent identity, prefixed by the source namespace that minted it:
/// `hc:<address>`, `claude:<session>`, `claude:<session>/<agent>`, `codex:<id>`,
/// `run:<id>`, `demo:<n>`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AgentId(String);

impl AgentId {
    /// The id of an hc terminal.
    pub fn terminal(address: &str) -> Self {
        Self(format!("hc:{address}"))
    }

    /// The id of a Claude Code session.
    pub fn claude_session(session: &str) -> Self {
        Self(format!("claude:{session}"))
    }

    /// The id of a Claude Code subagent inside a session.
    pub fn claude_subagent(session: &str, agent: &str) -> Self {
        Self(format!("claude:{session}/{agent}"))
    }

    /// The id of a Codex session.
    pub fn codex_session(session: &str) -> Self {
        Self(format!("codex:{session}"))
    }

    /// The id of a work-run record.
    pub fn run(id: &str) -> Self {
        Self(format!("run:{id}"))
    }

    /// Wraps an id received over the wire. Ids are opaque to viewers.
    pub fn from_wire(id: String) -> Self {
        Self(id)
    }

    /// The id as a string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for AgentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Where a fact came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SourceKind {
    /// hc terminals (`hc events`).
    Hc,
    /// Claude Code: the session registry and transcripts.
    Claude,
    /// Codex rollouts.
    Codex,
    /// Sessions macrod dispatched.
    Macrod,
    /// herdr manager directories.
    Manager,
    /// Generic work-run records.
    RunRecord,
    /// The scripted demo fleet.
    Demo,
}

impl SourceKind {
    /// Every source, in display order.
    pub const ALL: [SourceKind; 7] = [
        SourceKind::Hc,
        SourceKind::Claude,
        SourceKind::Codex,
        SourceKind::Macrod,
        SourceKind::Manager,
        SourceKind::RunRecord,
        SourceKind::Demo,
    ];

    /// A short lowercase name, used in span fields and the SOURCES pane.
    pub fn name(self) -> &'static str {
        match self {
            SourceKind::Hc => "hc",
            SourceKind::Claude => "claude",
            SourceKind::Codex => "codex",
            SourceKind::Macrod => "macrod",
            SourceKind::Manager => "manager",
            SourceKind::RunRecord => "run_record",
            SourceKind::Demo => "demo",
        }
    }

    fn bit(self) -> u8 {
        1 << (self as u8)
    }
}

/// The set of sources that contributed to one agent.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct SourceSet(u8);

impl SourceSet {
    /// Adds a source.
    pub fn insert(&mut self, source: SourceKind) {
        self.0 |= source.bit();
    }

    /// Whether the source contributed.
    pub fn contains(self, source: SourceKind) -> bool {
        self.0 & source.bit() != 0
    }

    /// The contributing sources, in display order.
    pub fn iter(self) -> impl Iterator<Item = SourceKind> {
        SourceKind::ALL
            .into_iter()
            .filter(move |source| self.contains(*source))
    }
}

impl FromIterator<SourceKind> for SourceSet {
    fn from_iter<I: IntoIterator<Item = SourceKind>>(sources: I) -> Self {
        let mut set = SourceSet::default();
        for source in sources {
            set.insert(source);
        }
        set
    }
}

/// What role an agent plays.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AgentKind {
    /// Runs a multi-step project through helpers.
    Manager,
    /// Changes code and ships it.
    Builder,
    /// Answers questions, read only.
    Explorer,
    /// Writes plans.
    Planner,
    /// Talks with a person.
    Chatter,
    /// Reviews a manager's work.
    Reviewer,
    /// A subagent inside another agent's session.
    Subagent,
    /// A session macrod dispatched.
    MacrodSession,
    /// A recorded work run.
    WorkRun,
    /// A factory job.
    Factory,
    /// A terminal running a shell or another program, not an agent.
    Shell,
    /// Anything else.
    Other,
}

impl AgentKind {
    /// A short lowercase label for the KIND column.
    pub fn label(self) -> &'static str {
        match self {
            AgentKind::Manager => "manager",
            AgentKind::Builder => "builder",
            AgentKind::Explorer => "explorer",
            AgentKind::Planner => "planner",
            AgentKind::Chatter => "chatter",
            AgentKind::Reviewer => "reviewer",
            AgentKind::Subagent => "subagent",
            AgentKind::MacrodSession => "session",
            AgentKind::WorkRun => "run",
            AgentKind::Factory => "factory",
            AgentKind::Shell => "shell",
            AgentKind::Other => "other",
        }
    }
}

/// An agent's state, in the order the AGENTS pane sorts by.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Status {
    /// Running a turn.
    Working,
    /// Blocked, for example on a permission prompt.
    Blocked,
    /// Waiting on a person.
    Waiting,
    /// Alive and idle.
    Idle,
    /// Finished successfully.
    Done,
    /// Finished with an error.
    Failed,
    /// Killed or stopped.
    Stopped,
}

impl Status {
    /// Whether the agent has ended.
    pub fn is_final(self) -> bool {
        matches!(self, Status::Done | Status::Failed | Status::Stopped)
    }
}

/// What an agent has cost. Never shown as `$0` when unknown.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Cost {
    /// Reported by the agent's own records.
    Known(f64),
    /// Summed usage times the price table.
    Estimated(f64),
    /// The model is missing from the price table, or there is no usage yet.
    #[default]
    Unpriced,
}

impl Cost {
    /// The dollar amount, if any is known or estimated.
    pub fn usd(self) -> Option<f64> {
        match self {
            Cost::Known(usd) | Cost::Estimated(usd) => Some(usd),
            Cost::Unpriced => None,
        }
    }

    /// Sums two costs: any estimate makes the sum an estimate, and an unpriced
    /// side adds nothing.
    pub fn plus(self, other: Cost) -> Cost {
        match (self, other) {
            (Cost::Unpriced, other) => other,
            (this, Cost::Unpriced) => this,
            (Cost::Known(a), Cost::Known(b)) => Cost::Known(a + b),
            (Cost::Known(a) | Cost::Estimated(a), Cost::Known(b) | Cost::Estimated(b)) => {
                Cost::Estimated(a + b)
            }
        }
    }
}

/// Token usage by class.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Tokens {
    /// Uncached input tokens.
    pub input: u64,
    /// Output tokens.
    pub output: u64,
    /// Input tokens read from the prompt cache.
    pub cache_read: u64,
    /// Input tokens written to the prompt cache.
    pub cache_write: u64,
}

impl Tokens {
    /// Every class summed.
    pub fn total(self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }

    /// Adds another usage record.
    pub fn add(&mut self, other: Tokens) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
    }
}

/// One agent, built by the reducer from every source that knows it.
#[derive(Clone, Debug, PartialEq)]
pub struct Agent {
    /// Stable identity.
    pub id: AgentId,
    /// Every source that contributed.
    pub sources: SourceSet,
    /// Role.
    pub kind: AgentKind,
    /// The hc name, else the session's name, else its title.
    pub name: String,
    /// The goal, title or task; at most 160 characters.
    pub task: Option<String>,
    /// Current state.
    pub status: Status,
    /// Why: "permission", an exit reason, a manager state.
    pub status_detail: Option<String>,
    /// The program, such as `claude-code`, `codex` or `bash`.
    pub program: Option<String>,
    /// The model in use.
    pub model: Option<String>,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Git branch.
    pub branch: Option<String>,
    /// herdr space name.
    pub space: Option<String>,
    /// herdr tags.
    pub tags: Vec<String>,
    /// The agent that started this one.
    pub parent: Option<AgentId>,
    /// Agents this one started.
    pub children: Vec<AgentId>,
    /// hc terminal address.
    pub terminal: Option<String>,
    /// The program's native session id.
    pub session: Option<String>,
    /// Transcript file.
    pub transcript: Option<PathBuf>,
    /// Process id of the program.
    pub pid: Option<u32>,
    /// When it started.
    pub started: Option<Timestamp>,
    /// When it ended.
    pub ended: Option<Timestamp>,
    /// Its last observed activity.
    pub last_activity: Option<Timestamp>,
    /// Turns so far.
    pub turns: u32,
    /// Tool calls so far.
    pub tool_calls: u32,
    /// Tool calls that failed.
    pub tool_errors: u32,
    /// The tool call still open: name and a gist, at most 80 characters.
    pub doing: Option<String>,
    /// Token usage.
    pub tokens: Tokens,
    /// Cost so far.
    pub cost: Cost,
    /// Failures in the last 24 hours.
    pub failures: u32,
    /// Tool calls plus turns per minute over the last hour, oldest first.
    pub activity: [u16; ACTIVITY_MINUTES],
}

impl Agent {
    /// An agent with only an identity, kind and name; every other field empty.
    pub fn new(id: AgentId, kind: AgentKind, name: String) -> Self {
        Self {
            id,
            sources: SourceSet::default(),
            kind,
            name,
            task: None,
            status: Status::Idle,
            status_detail: None,
            program: None,
            model: None,
            cwd: None,
            branch: None,
            space: None,
            tags: Vec::new(),
            parent: None,
            children: Vec::new(),
            terminal: None,
            session: None,
            transcript: None,
            pid: None,
            started: None,
            ended: None,
            last_activity: None,
            turns: 0,
            tool_calls: 0,
            tool_errors: 0,
            doing: None,
            tokens: Tokens::default(),
            cost: Cost::Unpriced,
            failures: 0,
            activity: [0; ACTIVITY_MINUTES],
        }
    }
}

/// What a tape line records.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TapeKind {
    /// An agent appeared.
    Spawned,
    /// Its status changed.
    Status,
    /// A turn started.
    TurnStart,
    /// A turn ended.
    TurnEnd,
    /// A tool call started.
    ToolStart,
    /// A tool call ended.
    ToolEnd,
    /// A tool call failed.
    ToolError,
    /// The agent failed.
    Failure,
    /// The agent finished.
    Finished,
    /// The agent was removed.
    Removed,
}

/// How loudly a tape line should show.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Severity {
    /// Routine.
    Info,
    /// Worth a glance.
    Notice,
    /// Something went wrong but the agent carries on.
    Warning,
    /// A failure.
    Error,
}

/// One line of the tape.
#[derive(Clone, Debug, PartialEq)]
pub struct TapeEvent {
    /// The store's sequence number when this line was written.
    pub seq: u64,
    /// When it happened.
    pub at: Timestamp,
    /// Which agent.
    pub agent: AgentId,
    /// What happened.
    pub kind: TapeKind,
    /// A short line: tool name and gist, turn number, exit reason. Never transcript text.
    pub text: String,
    /// How loudly to show it.
    pub severity: Severity,
}

/// The board numbers.
#[derive(Clone, Debug, PartialEq)]
pub struct Totals {
    /// Agents working now.
    pub working: u32,
    /// Agents waiting on a person.
    pub waiting: u32,
    /// Agents blocked.
    pub blocked: u32,
    /// Agents that failed in the last 24 hours.
    pub failed_24h: u32,
    /// Turns in the last 24 hours.
    pub turns_24h: u32,
    /// Tool calls in the last 24 hours.
    pub tools_24h: u32,
    /// Tool errors in the last 24 hours.
    pub errors_24h: u32,
    /// Spend since local midnight.
    pub cost_today: Cost,
    /// Spend per hour of the local day.
    pub cost_by_hour: [f32; HOURS_PER_DAY],
    /// Tokens per minute over the last hour, oldest first.
    pub tokens_per_min: [u32; ACTIVITY_MINUTES],
}

impl Default for Totals {
    fn default() -> Self {
        Self {
            working: 0,
            waiting: 0,
            blocked: 0,
            failed_24h: 0,
            turns_24h: 0,
            tools_24h: 0,
            errors_24h: 0,
            cost_today: Cost::Unpriced,
            cost_by_hour: [0.0; HOURS_PER_DAY],
            tokens_per_min: [0; ACTIVITY_MINUTES],
        }
    }
}

/// Whether a source is working.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SourceState {
    /// Started, nothing reported yet.
    Starting,
    /// Reporting.
    Healthy,
    /// Its last run failed; the supervisor is restarting it.
    Unhealthy,
    /// Not available on this machine.
    Absent,
}

/// Progress through a bounded job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    /// Items finished.
    pub done: u32,
    /// Items in total.
    pub total: u32,
}

/// One source's health, for the SOURCES pane.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceHealth {
    /// Which source.
    pub source: SourceKind,
    /// Its state.
    pub state: SourceState,
    /// The last error or a note.
    pub detail: Option<String>,
    /// Items it currently reports (terminals, transcripts, records).
    pub items: u32,
    /// When it last reported anything.
    pub last_event: Option<Timestamp>,
    /// Startup indexing, while it runs.
    pub indexing: Option<Progress>,
    /// How often the supervisor restarted it.
    pub restarts: u32,
}

impl SourceHealth {
    /// A source that has just started.
    pub fn starting(source: SourceKind) -> Self {
        Self {
            source,
            state: SourceState::Starting,
            detail: None,
            items: 0,
            last_event: None,
            indexing: None,
            restarts: 0,
        }
    }
}

/// Everything a new subscriber needs to draw.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Snapshot {
    /// Every agent.
    pub agents: Vec<Agent>,
    /// The last tape lines, oldest first.
    pub tape: Vec<TapeEvent>,
    /// The board numbers.
    pub totals: Totals,
    /// Every source's health.
    pub sources: Vec<SourceHealth>,
}

/// One change the store publishes.
#[derive(Clone, Debug, PartialEq)]
pub enum UpdateKind {
    /// The whole state; replaces anything the viewer holds.
    Snapshot(Snapshot),
    /// A whole agent row, replacing the row with the same id.
    Upsert(Agent),
    /// An agent that is gone.
    Removed(AgentId),
    /// One tape line.
    Event(TapeEvent),
    /// New board numbers.
    Totals(Totals),
    /// One source's health changed.
    Source(SourceHealth),
    /// The collector is alive.
    Heartbeat(Timestamp),
}

/// A sequenced change. Sequence numbers rise by one per published update; a
/// snapshot carries the sequence number of the last update it includes.
#[derive(Clone, Debug, PartialEq)]
pub struct Update {
    /// Sequence number.
    pub seq: u64,
    /// The change.
    pub kind: UpdateKind,
}

/// What a transcript item is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TranscriptItemKind {
    /// A message from the user or the harness.
    User,
    /// The assistant's text.
    Assistant,
    /// A tool call.
    ToolCall,
    /// A tool result.
    ToolResult,
}

/// One row of an agent's transcript, for the drill-in page.
#[derive(Clone, Debug, PartialEq)]
pub struct TranscriptItem {
    /// When it was written.
    pub at: Timestamp,
    /// What it is.
    pub kind: TranscriptItemKind,
    /// Message text, the tool call's arguments or its result, clipped.
    pub text: String,
    /// The tool call id, on tool rows.
    pub tool_id: Option<String>,
    /// The tool name, on tool rows.
    pub tool_name: Option<String>,
    /// Whether the tool call failed.
    pub is_error: bool,
    /// How long the tool call took, on result rows.
    pub duration_ms: Option<u64>,
}
