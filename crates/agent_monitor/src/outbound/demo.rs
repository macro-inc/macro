//! A scripted fleet for `--demo`, tests and recordings: about fifteen agents of
//! mixed kinds with parents and children, turns, tool calls, errors and cost.
//! Everything is synthetic and deterministic for a seed: the same seed, start
//! time and step count give the same observations.
//!
//! The fleet speaks the real sources' shapes (terminals, the Claude registry,
//! transcripts, manager directories), so it drives the store's joins rather
//! than bypassing them.

#[cfg(test)]
mod test;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use async_trait::async_trait;
use chrono::TimeDelta;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

use crate::domain::clock::Clock;
use crate::domain::model::{
    Agent, AgentKind, Cost, Snapshot, SourceHealth, SourceKind, SourceState, Timestamp, Tokens,
    TranscriptItem, TranscriptItemKind,
};
use crate::domain::observation::{
    Change, ClaudeSessionFact, Fact, FactKey, FinishReason, ManagerFact, Observation,
    TerminalActivity, TerminalFact, TerminalState, TranscriptDelta, TranscriptEvent,
    TranscriptEventKind, TranscriptKey, TranscriptProgram,
};
use crate::domain::source::{
    AgentSource, SourceError, TranscriptError, TranscriptFeed, TranscriptStream,
};
use crate::domain::store::{StoreConfig, replay};

/// The live fleet stays around this size: finished agents are replaced.
const FLEET_SIZE: usize = 15;

/// Steps a finished agent stays listed before it is removed.
const FINISHED_STEPS: u64 = 160;

/// Agents advanced per step.
const ADVANCES_PER_STEP: usize = 3;

/// Minutes of history the first reset carries, so sparklines start full.
const HISTORY_MINUTES: i64 = 60;

/// Transcript items kept per agent for `FollowTranscript`.
const LOG_ITEMS: usize = 200;

/// How the demo runs.
#[derive(Clone, Copy, Debug)]
pub struct DemoConfig {
    /// The script's seed.
    pub seed: u64,
    /// Time between steps.
    pub step: Duration,
}

impl Default for DemoConfig {
    fn default() -> Self {
        Self {
            seed: 7,
            step: Duration::from_millis(250),
        }
    }
}

/// The demo as a source.
pub struct DemoSource {
    config: DemoConfig,
    clock: Arc<dyn Clock>,
    transcripts: DemoTranscripts,
}

impl DemoSource {
    /// A demo source writing its transcript items into `transcripts`.
    pub fn new(config: DemoConfig, clock: Arc<dyn Clock>, transcripts: DemoTranscripts) -> Self {
        Self {
            config,
            clock,
            transcripts,
        }
    }
}

#[async_trait]
impl AgentSource for DemoSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Demo
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        let mut fleet = DemoFleet::new(self.config.seed, self.clock.now());
        let reset = fleet.reset();
        self.transcripts.clear();
        self.transcripts.append(reset.items);
        send(&out, Change::Reset(reset.facts)).await?;
        let health = SourceHealth {
            state: SourceState::Healthy,
            items: u32::try_from(fleet.agents.len()).unwrap_or(u32::MAX),
            ..SourceHealth::starting(SourceKind::Demo)
        };
        send(&out, Change::Health(health)).await?;

        let mut ticker = tokio::time::interval(self.config.step);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        ticker.tick().await;
        loop {
            tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                _ = ticker.tick() => {}
            }
            let step = fleet.step(self.clock.now());
            let span = tracing::debug_span!(
                "macrod.monitor.source.batch",
                source = SourceKind::Demo.name(),
                observations = step.changes.len(),
            );
            self.transcripts.append(step.items);
            async {
                for change in step.changes {
                    send(&out, change).await?;
                }
                Ok::<(), SourceError>(())
            }
            .instrument(span)
            .await?;
        }
    }
}

async fn send(out: &mpsc::Sender<Observation>, change: Change) -> Result<(), SourceError> {
    out.send(Observation {
        source: SourceKind::Demo,
        change,
    })
    .await
    .map_err(|_| SourceError::StoreClosed)
}

/// The observations of `steps` steps of the script, starting with its reset,
/// for tests that need a fixed fleet without running a source.
pub fn script(seed: u64, start: Timestamp, step: Duration, steps: u32) -> Vec<Observation> {
    let observation = |change| Observation {
        source: SourceKind::Demo,
        change,
    };
    let mut fleet = DemoFleet::new(seed, start);
    let mut observations = vec![observation(Change::Reset(fleet.reset().facts))];
    let step = TimeDelta::from_std(step).unwrap_or(TimeDelta::zero());

    for index in 1..=steps {
        let now = start + step * i32::try_from(index).unwrap_or(i32::MAX);
        observations.extend(fleet.step(now).changes.into_iter().map(observation));
    }
    observations
}

/// The state a live store would publish after `steps` steps of the script,
/// reduced once per step at a fixed clock. Deterministic for a seed, start
/// time and step count; "today" for spend is the UTC day.
pub fn snapshot(seed: u64, start: Timestamp, step: Duration, steps: u32) -> Snapshot {
    let observations = |changes: Vec<Change>| {
        changes
            .into_iter()
            .map(|change| Observation {
                source: SourceKind::Demo,
                change,
            })
            .collect::<Vec<_>>()
    };
    let mut fleet = DemoFleet::new(seed, start);
    let reset = vec![Change::Reset(fleet.reset().facts)];
    let step = TimeDelta::from_std(step).unwrap_or(TimeDelta::zero());

    let mut timeline = vec![(start, observations(reset))];
    for index in 1..=steps {
        let now = start + step * i32::try_from(index).unwrap_or(i32::MAX);
        timeline.push((now, observations(fleet.step(now).changes)));
    }
    let config = StoreConfig {
        day_offset: chrono::FixedOffset::east_opt(0),
        ..StoreConfig::default()
    };
    replay(config, timeline)
}

/// The demo's transcripts: the items its agents "wrote", for `FollowTranscript`.
#[derive(Clone, Debug)]
pub struct DemoTranscripts {
    shared: Arc<Mutex<DemoLog>>,
}

#[derive(Debug)]
struct DemoLog {
    items: HashMap<PathBuf, VecDeque<TranscriptItem>>,
    appended: broadcast::Sender<(PathBuf, TranscriptItem)>,
}

impl Default for DemoTranscripts {
    fn default() -> Self {
        let (appended, _) = broadcast::channel(1024);
        Self {
            shared: Arc::new(Mutex::new(DemoLog {
                items: HashMap::new(),
                appended,
            })),
        }
    }
}

impl DemoTranscripts {
    fn clear(&self) {
        self.lock().items.clear();
    }

    fn append(&self, items: Vec<(PathBuf, TranscriptItem)>) {
        let mut log = self.lock();
        for (path, item) in items {
            let entries = log.items.entry(path.clone()).or_default();
            if entries.len() == LOG_ITEMS {
                entries.pop_front();
            }
            entries.push_back(item.clone());
            // No followers is fine.
            let _ = log.appended.send((path, item));
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, DemoLog> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[async_trait]
impl TranscriptFeed for DemoTranscripts {
    async fn follow(
        &self,
        agent: &Agent,
        tail: usize,
    ) -> Result<TranscriptStream, TranscriptError> {
        let path = agent
            .transcript
            .clone()
            .ok_or(TranscriptError::Unavailable)?;

        // Copy the tail and subscribe under one lock, so no item falls between.
        let (past, mut appended) = {
            let log = self.lock();
            let entries = log.items.get(&path).ok_or(TranscriptError::Unavailable)?;
            let skip = entries.len().saturating_sub(tail);
            let past: Vec<TranscriptItem> = entries.iter().skip(skip).cloned().collect();
            (past, log.appended.subscribe())
        };

        Ok(Box::pin(async_stream::stream! {
            for item in past {
                yield item;
            }
            loop {
                match appended.recv().await {
                    Ok((item_path, item)) if item_path == path => yield item,
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }))
    }
}

/// What a reset carries.
#[derive(Debug, Default)]
pub struct DemoReset {
    /// Every fact the fleet starts with.
    pub facts: Vec<Fact>,
    /// The transcript items its history wrote.
    pub items: Vec<(PathBuf, TranscriptItem)>,
}

/// What one step changed.
#[derive(Debug, Default)]
pub struct DemoStep {
    /// The changes, in order.
    pub changes: Vec<Change>,
    /// The transcript items written.
    pub items: Vec<(PathBuf, TranscriptItem)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Program {
    Claude,
    Codex,
    Shell,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Phase {
    Idle,
    Turn {
        tools_left: u8,
        open: Option<(String, &'static str)>,
    },
    Waiting,
    Blocked,
    Finished,
}

#[derive(Clone, Debug)]
struct DemoAgent {
    /// The terminal address, or `None` for a session without a terminal.
    address: Option<String>,
    name: String,
    kind: AgentKind,
    parent: Option<String>,
    pid: Option<u32>,
    session: String,
    program: Program,
    model: Option<&'static str>,
    cwd: PathBuf,
    branch: String,
    goal: Option<String>,
    manager_dir: Option<PathBuf>,
    created: Timestamp,
    finished: Option<(Timestamp, i32, u64)>,
    phase: Phase,
    cost: f64,
    turn: u32,
    /// Subagents this agent started, by id.
    subagents: Vec<String>,
}

impl DemoAgent {
    fn path(&self) -> PathBuf {
        PathBuf::from(format!("demo/{}.jsonl", self.session))
    }

    fn transcript_key(&self) -> Option<TranscriptKey> {
        let program = match self.program {
            Program::Claude => TranscriptProgram::Claude,
            Program::Codex => TranscriptProgram::Codex,
            Program::Shell => return None,
        };
        Some(TranscriptKey {
            program,
            session: self.session.clone(),
            subagent: None,
        })
    }

    fn terminal(&self) -> Option<TerminalFact> {
        let address = self.address.clone()?;
        let (state, activity, exit_code, finish_reason, finished) = match self.finished {
            Some((at, code, _)) => (
                TerminalState::Finished,
                None,
                Some(code),
                Some(FinishReason::Exited),
                Some(at),
            ),
            None => {
                let activity = match self.phase {
                    Phase::Turn { .. } => TerminalActivity::Working,
                    Phase::Blocked => TerminalActivity::Blocked,
                    Phase::Idle | Phase::Waiting | Phase::Finished => TerminalActivity::Idle,
                };
                (TerminalState::Live, Some(activity), None, None, None)
            }
        };
        let program = match self.program {
            Program::Claude => "claude",
            Program::Codex => "codex",
            Program::Shell => "bash",
        };

        Some(TerminalFact {
            address,
            name: self.name.clone(),
            parent: self.parent.clone(),
            spawned_by: None,
            cwd: Some(self.cwd.clone()),
            state,
            activity,
            status_message: (self.phase == Phase::Blocked).then(|| String::from("permission")),
            turn: Some(self.turn),
            created: Some(self.created),
            finished,
            exit_code,
            finish_reason,
            foreground_pid: self.pid,
            program: Some(program.to_owned()),
            kind: Some(self.kind),
            model: self.model.map(str::to_owned),
            space: Some(String::from("demo")),
            goal: self.goal.clone(),
            waiting: self.phase == Phase::Waiting,
            manager_dir: self.manager_dir.clone(),
            macrod_session: None,
            run_id: None,
            tags: vec![String::from("demo")],
        })
    }

    fn registry(&self) -> Option<ClaudeSessionFact> {
        if self.program != Program::Claude {
            return None;
        }
        Some(ClaudeSessionFact {
            pid: self.pid?,
            session_id: self.session.clone(),
            cwd: Some(self.cwd.clone()),
            name: Some(self.name.clone()),
            busy: matches!(self.phase, Phase::Turn { .. }),
            updated: Some(self.created),
        })
    }

    fn delta(&self, events: Vec<TranscriptEvent>) -> Option<TranscriptDelta> {
        Some(TranscriptDelta {
            key: self.transcript_key()?,
            path: self.path(),
            from_start: false,
            cwd: Some(self.cwd.clone()),
            branch: Some(self.branch.clone()),
            model: self.model.map(str::to_owned),
            title: self.goal.clone(),
            events,
        })
    }

    /// A subagent's short transcript: one tool call and the turn's end.
    fn subagent_delta(&self, subagent: &str, at: Timestamp) -> TranscriptDelta {
        let tool = format!("{subagent}-read");
        TranscriptDelta {
            key: TranscriptKey {
                program: TranscriptProgram::Claude,
                session: self.session.clone(),
                subagent: Some(subagent.to_owned()),
            },
            path: PathBuf::from(format!("demo/{}/{subagent}.jsonl", self.session)),
            from_start: false,
            cwd: Some(self.cwd.clone()),
            branch: Some(self.branch.clone()),
            model: Some(String::from("claude-haiku-5-5")),
            title: Some(String::from("explore the reducer")),
            events: vec![
                TranscriptEvent {
                    at,
                    kind: TranscriptEventKind::ToolStart {
                        id: tool.clone(),
                        name: String::from("Read"),
                        gist: Some(String::from("store.rs")),
                    },
                },
                TranscriptEvent {
                    at,
                    kind: TranscriptEventKind::ToolEnd {
                        id: tool,
                        is_error: false,
                    },
                },
                TranscriptEvent {
                    at,
                    kind: TranscriptEventKind::TurnEnd,
                },
            ],
        }
    }

    fn is_live(&self) -> bool {
        self.finished.is_none() && self.program != Program::Shell
    }
}

/// One roster entry: name, kind, parent address, program, model, goal.
type RosterEntry = (
    &'static str,
    AgentKind,
    Option<&'static str>,
    Program,
    Option<&'static str>,
    &'static str,
);

const ROSTER: &[RosterEntry] = &[
    (
        "release-train",
        AgentKind::Manager,
        None,
        Program::Claude,
        Some("claude-opus-5-5"),
        "Ship the release branch",
    ),
    (
        "rpc-server",
        AgentKind::Builder,
        Some("t1"),
        Program::Claude,
        Some("claude-opus-5-5"),
        "Serve the monitor over a Unix socket",
    ),
    (
        "store-reducer",
        AgentKind::Builder,
        Some("t1"),
        Program::Claude,
        Some("claude-opus-5-5"),
        "Single-writer store and reducer",
    ),
    (
        "where-is-auth",
        AgentKind::Explorer,
        Some("t1"),
        Program::Claude,
        Some("claude-sonnet-5-5"),
        "Where does session auth live?",
    ),
    (
        "review-rpc",
        AgentKind::Reviewer,
        Some("t1"),
        Program::Claude,
        Some("claude-fable-5-2"),
        "Review the RPC changes",
    ),
    (
        "billing-revamp",
        AgentKind::Manager,
        None,
        Program::Claude,
        Some("claude-opus-5-5"),
        "Rework invoice exports",
    ),
    (
        "ui-pages",
        AgentKind::Builder,
        Some("t6"),
        Program::Claude,
        Some("claude-opus-5-5"),
        "Pages and drill-in",
    ),
    (
        "mesh-plan",
        AgentKind::Planner,
        Some("t6"),
        Program::Claude,
        Some("claude-fable-5-2"),
        "Plan the figure widget",
    ),
    (
        "invoice-export",
        AgentKind::Builder,
        Some("t6"),
        Program::Claude,
        Some("claude-sonnet-5-5"),
        "CSV export for invoices",
    ),
    (
        "trace-gaps",
        AgentKind::Explorer,
        Some("t6"),
        Program::Claude,
        Some("claude-haiku-5-5"),
        "Find spans missing a parent",
    ),
    (
        "chat-desk",
        AgentKind::Chatter,
        None,
        Program::Claude,
        Some("claude-opus-5-5"),
        "Answer questions",
    ),
    (
        "q4-roadmap",
        AgentKind::Planner,
        None,
        Program::Claude,
        Some("claude-fable-5-2"),
        "Draft the quarter's plan",
    ),
    (
        "logs",
        AgentKind::Shell,
        None,
        Program::Shell,
        None,
        "tail service logs",
    ),
    (
        "flaky-tests",
        AgentKind::Builder,
        None,
        Program::Claude,
        Some("claude-sonnet-5-5"),
        "Fix the flaky suite",
    ),
];

const TOOLS: &[(&str, &[&str])] = &[
    (
        "Read",
        &[
            "store.rs",
            "server.rs",
            "model.rs",
            "Cargo.toml",
            "AGENTS.md",
        ],
    ),
    ("Edit", &["store.rs", "client.rs", "pages.rs", "export.rs"]),
    (
        "Bash",
        &["cargo test", "cargo clippy", "git status", "just check"],
    ),
    ("Grep", &["TapeEvent", "subscribe", "Snapshot"]),
    ("Write", &["test.rs", "README.md"]),
    ("Task", &["explore the reducer"]),
];

struct ToolStarted {
    id: String,
    name: &'static str,
    event: TranscriptEvent,
    item: TranscriptItem,
}

/// The scripted fleet.
pub struct DemoFleet {
    rng: StdRng,
    agents: Vec<DemoAgent>,
    start: Timestamp,
    steps: u64,
    next_terminal: u32,
    next_session: u32,
    next_tool: u64,
}

impl DemoFleet {
    /// A fleet for `seed`, whose history ends at `start`.
    pub fn new(seed: u64, start: Timestamp) -> Self {
        let mut fleet = Self {
            rng: StdRng::seed_from_u64(seed),
            agents: Vec::new(),
            start,
            steps: 0,
            next_terminal: 1,
            next_session: 1,
            next_tool: 1,
        };

        for (name, kind, parent, program, model, goal) in ROSTER {
            let age = TimeDelta::minutes(fleet.rng.random_range(20..HISTORY_MINUTES));
            fleet.add_agent(
                name,
                *kind,
                parent.map(str::to_owned),
                *program,
                *model,
                goal,
                start - age,
            );
        }

        // A Claude session started outside any terminal, and a Codex session.
        let notes_age = TimeDelta::minutes(35);
        fleet.add_session(
            "scratch-notes",
            Program::Claude,
            Some("claude-sonnet-5-5"),
            start - notes_age,
        );
        fleet.add_session(
            "lint-sweep",
            Program::Codex,
            None,
            start - TimeDelta::minutes(25),
        );

        // One builder has a subagent running.
        if let Some(agent) = fleet
            .agents
            .iter_mut()
            .find(|agent| agent.name == "rpc-server")
        {
            agent.subagents.push(String::from("agent-demo-1"));
        }

        // One builder already failed before the demo starts.
        if let Some(agent) = fleet
            .agents
            .iter_mut()
            .find(|agent| agent.name == "flaky-tests")
        {
            agent.finished = Some((start - TimeDelta::minutes(4), 1, 0));
            agent.phase = Phase::Finished;
        }
        fleet
    }

    #[expect(clippy::too_many_arguments, reason = "one roster row's fields")]
    fn add_agent(
        &mut self,
        name: &str,
        kind: AgentKind,
        parent: Option<String>,
        program: Program,
        model: Option<&'static str>,
        goal: &str,
        created: Timestamp,
    ) -> usize {
        let address = format!("t{}", self.next_terminal);
        self.next_terminal += 1;
        let session = format!("demo-session-{:03}", self.next_session);
        self.next_session += 1;
        let manager_dir =
            (kind == AgentKind::Manager).then(|| PathBuf::from(format!("demo/managers/{address}")));

        self.agents.push(DemoAgent {
            address: Some(address),
            name: name.to_owned(),
            kind,
            parent,
            pid: Some(40_000 + self.next_session),
            session,
            program,
            model,
            cwd: PathBuf::from(format!("/srv/work/{name}")),
            branch: format!("feat/{name}"),
            goal: Some(goal.to_owned()),
            manager_dir,
            created,
            finished: None,
            phase: Phase::Idle,
            cost: 0.0,
            turn: 0,
            subagents: Vec::new(),
        });
        self.agents.len() - 1
    }

    fn add_session(
        &mut self,
        name: &str,
        program: Program,
        model: Option<&'static str>,
        created: Timestamp,
    ) {
        let session = format!("demo-session-{:03}", self.next_session);
        self.next_session += 1;
        let pid = (program == Program::Claude).then_some(40_000 + self.next_session);
        self.agents.push(DemoAgent {
            address: None,
            name: name.to_owned(),
            kind: AgentKind::Other,
            parent: None,
            pid,
            session,
            program,
            model,
            cwd: PathBuf::from(format!("/srv/work/{name}")),
            branch: String::from("main"),
            goal: Some(format!("{name} session")),
            manager_dir: None,
            created,
            finished: None,
            phase: Phase::Idle,
            cost: 0.0,
            turn: 0,
            subagents: Vec::new(),
        });
    }

    /// Every fact the fleet starts with, including an hour of transcript history.
    pub fn reset(&mut self) -> DemoReset {
        let mut reset = DemoReset::default();
        for index in 0..self.agents.len() {
            let history = self.history(index);
            let agent = &self.agents[index];
            reset.items.extend(history.1);
            if let Some(terminal) = agent.terminal() {
                reset.facts.push(Fact::Terminal(Box::new(terminal)));
            }
            if let Some(registry) = agent.registry() {
                reset.facts.push(Fact::ClaudeSession(registry));
            }
            if let Some(delta) = agent.delta(history.0) {
                reset.facts.push(Fact::Transcript(delta));
            }
            for subagent in &agent.subagents {
                let at = self.start - TimeDelta::minutes(2);
                reset
                    .facts
                    .push(Fact::Transcript(agent.subagent_delta(subagent, at)));
            }
            if let Some(dir) = &agent.manager_dir {
                reset.facts.push(Fact::Manager(ManagerFact {
                    dir: dir.clone(),
                    goal: agent.goal.clone(),
                    state: Some(String::from("building")),
                    reviews: 1,
                    last_verdict: Some(String::from("changes requested")),
                }));
            }
        }
        reset
    }

    /// Past turns, from the agent's creation until the fleet's start.
    fn history(&mut self, index: usize) -> (Vec<TranscriptEvent>, Vec<(PathBuf, TranscriptItem)>) {
        let mut events = Vec::new();
        let mut items = Vec::new();
        let created = self.agents[index].created;
        let end = self.agents[index]
            .finished
            .map_or(self.start, |finished| finished.0);
        if self.agents[index].program == Program::Shell {
            return (events, items);
        }

        let mut at = created + TimeDelta::seconds(20);
        while at < end - TimeDelta::seconds(30) {
            let turn = self.turn_events(index, at);
            at = turn.0 + TimeDelta::seconds(self.rng.random_range(30..240));
            events.extend(turn.1);
            items.extend(turn.2);
        }
        (events, items)
    }

    /// A whole turn starting at `at`: returns when it ended, its events and items.
    fn turn_events(
        &mut self,
        index: usize,
        mut at: Timestamp,
    ) -> (
        Timestamp,
        Vec<TranscriptEvent>,
        Vec<(PathBuf, TranscriptItem)>,
    ) {
        let path = self.agents[index].path();
        let mut events = vec![TranscriptEvent {
            at,
            kind: TranscriptEventKind::TurnStart,
        }];
        let mut items = vec![(path.clone(), user_item(at, self.agents[index].turn))];

        for _ in 0..self.rng.random_range(1..6) {
            at += TimeDelta::seconds(self.rng.random_range(2..20));
            let started = self.tool_start(at);
            events.push(started.event);
            items.push((path.clone(), started.item));
            let (id, name) = (started.id, started.name);
            at += TimeDelta::seconds(self.rng.random_range(1..30));
            let is_error = self.rng.random_bool(0.06);
            events.push(TranscriptEvent {
                at,
                kind: TranscriptEventKind::ToolEnd {
                    id: id.clone(),
                    is_error,
                },
            });
            items.push((path.clone(), result_item(at, &id, name, is_error)));
        }

        at += TimeDelta::seconds(self.rng.random_range(2..15));
        let end = self.turn_end(index, at);
        events.extend(end.0);
        items.push((path, end.1));
        (at, events, items)
    }

    fn tool_start(&mut self, at: Timestamp) -> ToolStarted {
        let (name, gists) = TOOLS[self.rng.random_range(0..TOOLS.len())];
        let gist = gists[self.rng.random_range(0..gists.len())];
        let id = format!("toolu_demo_{:05}", self.next_tool);
        self.next_tool += 1;

        let event = TranscriptEvent {
            at,
            kind: TranscriptEventKind::ToolStart {
                id: id.clone(),
                name: name.to_owned(),
                gist: Some(gist.to_owned()),
            },
        };
        let item = TranscriptItem {
            at,
            kind: TranscriptItemKind::ToolCall,
            text: format!("{{\"target\":\"{gist}\"}}"),
            tool_id: Some(id.clone()),
            tool_name: Some(name.to_owned()),
            is_error: false,
            duration_ms: None,
        };
        ToolStarted {
            id,
            name,
            event,
            item,
        }
    }

    /// Usage, the running cost and the turn's end.
    fn turn_end(&mut self, index: usize, at: Timestamp) -> (Vec<TranscriptEvent>, TranscriptItem) {
        let tokens = Tokens {
            input: self.rng.random_range(2_000..20_000),
            output: self.rng.random_range(200..3_000),
            cache_read: self.rng.random_range(20_000..150_000),
            cache_write: self.rng.random_range(0..8_000),
            cache_write_1h: 0,
        };
        // Plausible demo figures, not a price table.
        let increase = (tokens.input as f64 * 4.0
            + tokens.output as f64 * 20.0
            + tokens.cache_read as f64 * 0.4
            + tokens.cache_write as f64 * 5.0)
            / 1_000_000.0;
        let agent = &mut self.agents[index];
        agent.cost += increase;
        agent.turn += 1;

        let events = vec![
            TranscriptEvent {
                at,
                kind: TranscriptEventKind::Usage(tokens),
            },
            TranscriptEvent {
                at,
                kind: TranscriptEventKind::Cost(Cost::Estimated(agent.cost)),
            },
            TranscriptEvent {
                at,
                kind: TranscriptEventKind::TurnEnd,
            },
        ];
        let item = TranscriptItem {
            at,
            kind: TranscriptItemKind::Assistant,
            text: format!("Finished step {} of the task.", agent.turn),
            tool_id: None,
            tool_name: None,
            is_error: false,
            duration_ms: None,
        };
        (events, item)
    }

    /// Advances the script by one step.
    pub fn step(&mut self, now: Timestamp) -> DemoStep {
        self.steps += 1;
        let mut step = DemoStep::default();

        let live: Vec<usize> = (0..self.agents.len())
            .filter(|index| self.agents[*index].is_live())
            .collect();
        for _ in 0..ADVANCES_PER_STEP.min(live.len()) {
            let index = live[self.rng.random_range(0..live.len())];
            self.advance(index, now, &mut step);
        }

        if self.rng.random_bool(0.012) {
            self.finish_one(now, &mut step);
        }
        if live.len() < FLEET_SIZE && self.rng.random_bool(0.05) {
            self.spawn_one(now, &mut step);
        }
        self.remove_expired(&mut step);
        step
    }

    fn advance(&mut self, index: usize, now: Timestamp, step: &mut DemoStep) {
        let path = self.agents[index].path();
        let phase = self.agents[index].phase.clone();
        let mut events = Vec::new();

        let next = match phase {
            Phase::Idle if self.rng.random_bool(0.5) => {
                events.push(TranscriptEvent {
                    at: now,
                    kind: TranscriptEventKind::TurnStart,
                });
                step.items
                    .push((path, user_item(now, self.agents[index].turn)));
                Phase::Turn {
                    tools_left: self.rng.random_range(1..6),
                    open: None,
                }
            }
            Phase::Idle => {
                let waits = matches!(
                    self.agents[index].kind,
                    AgentKind::Chatter | AgentKind::Planner
                );
                if waits && self.rng.random_bool(0.2) {
                    Phase::Waiting
                } else {
                    Phase::Idle
                }
            }
            Phase::Turn {
                tools_left,
                open: Some((id, name)),
            } => {
                let is_error = self.rng.random_bool(0.08);
                events.push(TranscriptEvent {
                    at: now,
                    kind: TranscriptEventKind::ToolEnd {
                        id: id.clone(),
                        is_error,
                    },
                });
                step.items
                    .push((path, result_item(now, &id, name, is_error)));
                Phase::Turn {
                    tools_left: tools_left.saturating_sub(1),
                    open: None,
                }
            }
            Phase::Turn {
                tools_left: 0,
                open: None,
            } => {
                let (end, item) = self.turn_end(index, now);
                events.extend(end);
                step.items.push((path, item));
                Phase::Idle
            }
            Phase::Turn {
                tools_left,
                open: None,
            } => {
                if self.rng.random_bool(0.03) {
                    Phase::Blocked
                } else {
                    let started = self.tool_start(now);
                    if started.name == "Task" && self.agents[index].program == Program::Claude {
                        // One subagent per agent at a time: a new one replaces the last.
                        let agent = &mut self.agents[index];
                        for previous in std::mem::take(&mut agent.subagents) {
                            if let Some(key) = agent.transcript_key() {
                                step.changes.push(Change::Remove(FactKey::Transcript(
                                    TranscriptKey {
                                        subagent: Some(previous),
                                        ..key
                                    },
                                )));
                            }
                        }
                        let subagent = format!("agent-{}", started.id);
                        let delta = agent.subagent_delta(&subagent, now);
                        step.changes.push(Change::Upsert(Fact::Transcript(delta)));
                        agent.subagents.push(subagent);
                    }
                    events.push(started.event);
                    step.items.push((path, started.item));
                    Phase::Turn {
                        tools_left,
                        open: Some((started.id, started.name)),
                    }
                }
            }
            Phase::Waiting if self.rng.random_bool(0.15) => Phase::Idle,
            Phase::Blocked if self.rng.random_bool(0.25) => Phase::Turn {
                tools_left: 1,
                open: None,
            },
            other => other,
        };

        let terminal_changed = activity_of(&self.agents[index].phase) != activity_of(&next)
            || self.agents[index].phase == Phase::Waiting
            || next == Phase::Waiting;
        self.agents[index].phase = next;

        let agent = &self.agents[index];
        if !events.is_empty()
            && let Some(delta) = agent.delta(events)
        {
            step.changes.push(Change::Upsert(Fact::Transcript(delta)));
        }
        if terminal_changed {
            if let Some(terminal) = agent.terminal() {
                step.changes
                    .push(Change::Upsert(Fact::Terminal(Box::new(terminal))));
            }
            if let Some(registry) = agent.registry() {
                step.changes
                    .push(Change::Upsert(Fact::ClaudeSession(registry)));
            }
        }
    }

    /// Ends one worker: most finish cleanly, some fail.
    fn finish_one(&mut self, now: Timestamp, step: &mut DemoStep) {
        let workers: Vec<usize> = (0..self.agents.len())
            .filter(|index| {
                let agent = &self.agents[*index];
                agent.is_live()
                    && agent.address.is_some()
                    && matches!(agent.kind, AgentKind::Builder | AgentKind::Explorer)
            })
            .collect();
        if workers.is_empty() {
            return;
        }

        let index = workers[self.rng.random_range(0..workers.len())];
        let exit_code = if self.rng.random_bool(0.3) { 1 } else { 0 };
        let agent = &mut self.agents[index];
        agent.finished = Some((now, exit_code, self.steps));
        agent.phase = Phase::Finished;
        if let Some(terminal) = agent.terminal() {
            step.changes
                .push(Change::Upsert(Fact::Terminal(Box::new(terminal))));
        }
    }

    /// Starts a new worker under one of the managers.
    fn spawn_one(&mut self, now: Timestamp, step: &mut DemoStep) {
        let managers: Vec<String> = self
            .agents
            .iter()
            .filter(|agent| agent.kind == AgentKind::Manager && agent.is_live())
            .filter_map(|agent| agent.address.clone())
            .collect();
        let parent = (!managers.is_empty())
            .then(|| managers[self.rng.random_range(0..managers.len())].clone());
        let (kind, prefix) = if self.rng.random_bool(0.7) {
            (AgentKind::Builder, "fix")
        } else {
            (AgentKind::Explorer, "find")
        };
        let name = format!("{prefix}-{}", self.next_terminal);
        let index = self.add_agent(
            &name,
            kind,
            parent,
            Program::Claude,
            Some("claude-sonnet-5-5"),
            "Follow-up from review",
            now,
        );

        let agent = &self.agents[index];
        if let Some(terminal) = agent.terminal() {
            step.changes
                .push(Change::Upsert(Fact::Terminal(Box::new(terminal))));
        }
        if let Some(registry) = agent.registry() {
            step.changes
                .push(Change::Upsert(Fact::ClaudeSession(registry)));
        }
        if let Some(delta) = agent.delta(Vec::new()) {
            step.changes.push(Change::Upsert(Fact::Transcript(delta)));
        }
    }

    /// Removes agents that finished long enough ago.
    fn remove_expired(&mut self, step: &mut DemoStep) {
        let steps = self.steps;
        let (expired, kept): (Vec<DemoAgent>, Vec<DemoAgent>) =
            self.agents.drain(..).partition(|agent| {
                agent
                    .finished
                    .is_some_and(|(_, _, at_step)| at_step > 0 && steps - at_step > FINISHED_STEPS)
            });
        self.agents = kept;

        for agent in expired {
            if let Some(address) = &agent.address {
                step.changes
                    .push(Change::Remove(FactKey::Terminal(address.clone())));
            }
            if let Some(pid) = agent.pid {
                step.changes
                    .push(Change::Remove(FactKey::ClaudeSession(pid)));
            }
            if let Some(key) = agent.transcript_key() {
                for subagent in &agent.subagents {
                    step.changes
                        .push(Change::Remove(FactKey::Transcript(TranscriptKey {
                            subagent: Some(subagent.clone()),
                            ..key.clone()
                        })));
                }
                step.changes.push(Change::Remove(FactKey::Transcript(key)));
            }
        }
    }
}

fn activity_of(phase: &Phase) -> TerminalActivity {
    match phase {
        Phase::Turn { .. } => TerminalActivity::Working,
        Phase::Blocked => TerminalActivity::Blocked,
        Phase::Idle | Phase::Waiting | Phase::Finished => TerminalActivity::Idle,
    }
}

fn user_item(at: Timestamp, turn: u32) -> TranscriptItem {
    TranscriptItem {
        at,
        kind: TranscriptItemKind::User,
        text: format!("Continue with step {} of the plan.", turn + 1),
        tool_id: None,
        tool_name: None,
        is_error: false,
        duration_ms: None,
    }
}

fn result_item(at: Timestamp, id: &str, name: &str, is_error: bool) -> TranscriptItem {
    let text = if is_error {
        format!("{name} failed: exit status 1")
    } else {
        format!("{name} ok")
    };
    TranscriptItem {
        at,
        kind: TranscriptItemKind::ToolResult,
        text,
        tool_id: Some(id.to_owned()),
        tool_name: Some(name.to_owned()),
        is_error,
        duration_ms: None,
    }
}
