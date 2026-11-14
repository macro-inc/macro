//! The reducer's pure half: facts filed by key, and the join that turns them
//! into agents (the join table is in [`crate::domain::observation`]). The store
//! owns the loop around it: it applies observations, builds agents, diffs them
//! against the rows it published, and writes the tape.

#[cfg(test)]
mod test;

use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::{DurationRound, TimeDelta};

use crate::domain::model::{
    ACTIVITY_MINUTES, Agent, AgentId, AgentKind, Cost, SourceKind, Status, Timestamp, Tokens,
};
use crate::domain::observation::{
    Change, ClaudeSessionFact, Fact, FactKey, FinishReason, MacrodSessionFact, ManagerFact,
    Observation, RunRecordFact, TerminalActivity, TerminalFact, TerminalState, TranscriptDelta,
    TranscriptEventKind, TranscriptKey, TranscriptProgram,
};
use crate::domain::pricing;

/// A transcript written this recently counts as working when no terminal says otherwise.
const TRANSCRIPT_WORKING_WINDOW: TimeDelta = TimeDelta::seconds(90);

/// How far back the per-minute counts reach.
const HISTORY: TimeDelta = TimeDelta::hours(24);

/// Longest task text kept on a row.
const TASK_CHARS: usize = 160;

/// Longest `doing` text kept on a row.
const DOING_CHARS: usize = 80;

/// A Codex terminal started at most this long after its rollout's first
/// record still counts as the terminal that wrote it.
const CODEX_START_SLACK: TimeDelta = TimeDelta::seconds(60);

/// One transcript record worth a tape line, from [`Facts::apply`].
#[derive(Clone, Debug, PartialEq)]
pub struct FactEvent {
    /// The fact it belongs to.
    pub key: FactKey,
    /// When it happened.
    pub at: Timestamp,
    /// What it records.
    pub kind: TranscriptEventKind,
}

/// Counts for one minute, summed over every transcript.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MinuteCounts {
    /// Turns ended.
    pub turns: u32,
    /// Tool calls started.
    pub tools: u32,
    /// Tool calls that failed.
    pub errors: u32,
    /// Tokens of every class.
    pub tokens: u64,
    /// Spend, from the cost each transcript reported in that minute.
    pub cost_usd: f64,
}

/// Agents built from facts, and which agent each fact merged into.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Built {
    /// Every agent by id.
    pub agents: BTreeMap<AgentId, Agent>,
    /// The agent each fact merged into.
    pub owners: BTreeMap<FactKey, AgentId>,
}

#[derive(Clone, Debug)]
struct Owned<T> {
    source: SourceKind,
    fact: T,
}

/// One transcript's counts for one minute.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct TranscriptMinute {
    turns: u32,
    tools: u32,
    errors: u32,
    tokens: u64,
    /// Usage in this minute times the price table.
    estimated_usd: f64,
}

/// What one transcript added up to so far.
#[derive(Clone, Debug)]
struct TranscriptState {
    path: PathBuf,
    cwd: Option<PathBuf>,
    branch: Option<String>,
    model: Option<String>,
    title: Option<String>,
    turns: u32,
    tool_calls: u32,
    tool_errors: u32,
    open_tools: BTreeMap<String, String>,
    tokens: Tokens,
    /// The last running total the program reported (`Cost::Known`).
    reported: Option<f64>,
    /// Every usage record priced at the model that produced it.
    estimated: Cost,
    first_at: Option<Timestamp>,
    last_at: Option<Timestamp>,
    minutes: BTreeMap<Timestamp, TranscriptMinute>,
}

impl TranscriptState {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            cwd: None,
            branch: None,
            model: None,
            title: None,
            turns: 0,
            tool_calls: 0,
            tool_errors: 0,
            open_tools: BTreeMap::new(),
            tokens: Tokens::default(),
            reported: None,
            estimated: Cost::Unpriced,
            first_at: None,
            last_at: None,
            minutes: BTreeMap::new(),
        }
    }

    fn absorb(&mut self, delta: &TranscriptDelta, now: Timestamp) {
        self.path.clone_from(&delta.path);
        if delta.cwd.is_some() {
            self.cwd.clone_from(&delta.cwd);
        }
        if delta.branch.is_some() {
            self.branch.clone_from(&delta.branch);
        }
        if delta.model.is_some() {
            self.model.clone_from(&delta.model);
        }
        if delta.title.is_some() {
            self.title.clone_from(&delta.title);
        }

        for event in &delta.events {
            self.first_at = Some(self.first_at.map_or(event.at, |first| first.min(event.at)));
            self.last_at = Some(self.last_at.map_or(event.at, |last| last.max(event.at)));
            let minute = self.minutes.entry(minute_of(event.at)).or_default();

            match &event.kind {
                TranscriptEventKind::TurnStart => {}
                TranscriptEventKind::TurnEnd => {
                    self.turns += 1;
                    minute.turns += 1;
                }
                TranscriptEventKind::ToolStart { id, name, gist } => {
                    self.tool_calls += 1;
                    minute.tools += 1;
                    let doing = match gist {
                        Some(gist) => format!("{name} {gist}"),
                        None => name.clone(),
                    };
                    self.open_tools
                        .insert(id.clone(), clip(&doing, DOING_CHARS));
                }
                TranscriptEventKind::ToolEnd { id, is_error } => {
                    self.open_tools.remove(id);
                    if *is_error {
                        self.tool_errors += 1;
                        minute.errors += 1;
                    }
                }
                TranscriptEventKind::Usage(tokens) => {
                    self.tokens.add(*tokens);
                    minute.tokens += tokens.total();
                    // A delta holds one model, so this prices the response at
                    // the model that produced it.
                    let estimate = pricing::estimate(self.model.as_deref(), *tokens);
                    minute.estimated_usd += estimate.usd().unwrap_or(0.0);
                    self.estimated = self.estimated.plus(estimate);
                }
                TranscriptEventKind::Cost(cost) => {
                    // A reported cost is a running total; the last one wins.
                    if let Some(usd) = cost.usd() {
                        self.reported = Some(usd);
                    }
                }
            }
        }

        let horizon = now - HISTORY;
        self.minutes.retain(|minute, _| *minute >= horizon);
    }

    /// What this transcript alone cost: the program's own total when it
    /// reported one, else the estimate (unpriced when nothing was priced).
    fn cost(&self) -> Cost {
        match self.reported {
            Some(usd) => Cost::Known(usd),
            None => self.estimated,
        }
    }
}

/// Every fact the sources reported, filed by key.
#[derive(Clone, Debug, Default)]
pub struct Facts {
    terminals: BTreeMap<String, Owned<TerminalFact>>,
    claude_sessions: BTreeMap<u32, Owned<ClaudeSessionFact>>,
    transcripts: BTreeMap<TranscriptKey, Owned<TranscriptState>>,
    macrod_sessions: BTreeMap<String, Owned<MacrodSessionFact>>,
    managers: BTreeMap<PathBuf, Owned<ManagerFact>>,
    run_records: BTreeMap<String, Owned<RunRecordFact>>,
    /// The Claude Code registry reported, so a session missing from it has
    /// no running process.
    registry_seen: bool,
}

impl Facts {
    /// Applies one observation and returns the transcript records it added.
    /// Health changes are the store's and are ignored here.
    pub fn apply(&mut self, observation: Observation, now: Timestamp) -> Vec<FactEvent> {
        let source = observation.source;
        match observation.change {
            Change::Upsert(fact) => self.upsert(source, fact, now),
            Change::Remove(key) => {
                self.remove(&key);
                Vec::new()
            }
            Change::Reset(facts) => {
                if source == SourceKind::ClaudeRegistry {
                    self.registry_seen = true;
                }
                self.forget(source);
                facts
                    .into_iter()
                    .flat_map(|fact| self.upsert(source, fact, now))
                    .collect()
            }
            Change::Health(_) => Vec::new(),
        }
    }

    fn upsert(&mut self, source: SourceKind, fact: Fact, now: Timestamp) -> Vec<FactEvent> {
        match fact {
            Fact::Terminal(terminal) => {
                let fact = *terminal;
                self.terminals
                    .insert(fact.address.clone(), Owned { source, fact });
            }
            Fact::ClaudeSession(fact) => {
                self.claude_sessions
                    .insert(fact.pid, Owned { source, fact });
            }
            Fact::MacrodSession(fact) => {
                self.macrod_sessions
                    .insert(fact.id.clone(), Owned { source, fact });
            }
            Fact::Manager(fact) => {
                self.managers
                    .insert(fact.dir.clone(), Owned { source, fact });
            }
            Fact::RunRecord(fact) => {
                self.run_records
                    .insert(fact.id.clone(), Owned { source, fact });
            }
            Fact::Transcript(delta) => {
                let key = FactKey::Transcript(delta.key.clone());
                let entry = self
                    .transcripts
                    .entry(delta.key.clone())
                    .or_insert_with(|| Owned {
                        source,
                        fact: TranscriptState::new(delta.path.clone()),
                    });
                if delta.from_start {
                    entry.fact = TranscriptState::new(delta.path.clone());
                }
                entry.source = source;
                entry.fact.absorb(&delta, now);

                return delta
                    .events
                    .into_iter()
                    .map(|event| FactEvent {
                        key: key.clone(),
                        at: event.at,
                        kind: event.kind,
                    })
                    .collect();
            }
        }
        Vec::new()
    }

    fn remove(&mut self, key: &FactKey) {
        match key {
            FactKey::Terminal(address) => {
                self.terminals.remove(address);
            }
            FactKey::ClaudeSession(pid) => {
                self.claude_sessions.remove(pid);
            }
            FactKey::Transcript(key) => {
                self.transcripts.remove(key);
            }
            FactKey::MacrodSession(id) => {
                self.macrod_sessions.remove(id);
            }
            FactKey::Manager(dir) => {
                self.managers.remove(dir);
            }
            FactKey::RunRecord(id) => {
                self.run_records.remove(id);
            }
        }
    }

    fn forget(&mut self, source: SourceKind) {
        self.terminals.retain(|_, owned| owned.source != source);
        self.claude_sessions
            .retain(|_, owned| owned.source != source);
        self.transcripts.retain(|_, owned| owned.source != source);
        self.macrod_sessions
            .retain(|_, owned| owned.source != source);
        self.managers.retain(|_, owned| owned.source != source);
        self.run_records.retain(|_, owned| owned.source != source);
    }
}

/// Per-minute counts over the last 24 hours, summed over every transcript.
///
/// Spend per minute is each transcript's estimate for that minute. When a
/// session reported its own total (which covers its subagents too), every
/// estimate in that session is scaled so the session sums to the reported
/// total; a session that reported a total but has no priced usage puts it in
/// the minute it last wrote.
pub fn minute_counts(facts: &Facts, now: Timestamp) -> BTreeMap<Timestamp, MinuteCounts> {
    let horizon = now - HISTORY;

    // Scale per session: reported total over the session's whole estimate.
    let mut sessions: BTreeMap<(TranscriptProgram, &str), (Option<f64>, f64)> = BTreeMap::new();
    for (key, owned) in &facts.transcripts {
        let entry = sessions
            .entry((key.program, key.session.as_str()))
            .or_default();
        if key.subagent.is_none() {
            entry.0 = owned.fact.reported;
        }
        entry.1 += owned.fact.estimated.usd().unwrap_or(0.0);
    }

    let mut counts: BTreeMap<Timestamp, MinuteCounts> = BTreeMap::new();
    for (key, owned) in &facts.transcripts {
        let transcript = &owned.fact;
        let (reported, estimated) = sessions
            .get(&(key.program, key.session.as_str()))
            .copied()
            .unwrap_or_default();
        let scale = match reported {
            Some(reported) if estimated > 0.0 => reported / estimated,
            _ => 1.0,
        };

        for (minute, minute_counts) in transcript.minutes.range(horizon..) {
            let total = counts.entry(*minute).or_default();
            total.turns += minute_counts.turns;
            total.tools += minute_counts.tools;
            total.errors += minute_counts.errors;
            total.tokens += minute_counts.tokens;
            total.cost_usd += minute_counts.estimated_usd * scale;
        }

        let unpriced_report = key.subagent.is_none() && estimated <= 0.0;
        if let (true, Some(reported), Some(last)) =
            (unpriced_report, transcript.reported, transcript.last_at)
        {
            let minute = minute_of(last);
            if minute >= horizon {
                counts.entry(minute).or_default().cost_usd += reported;
            }
        }
    }
    counts
}

/// Joins every fact into agents, by the join table in
/// [`crate::domain::observation`]:
///
/// 1. every hc terminal is an agent, enriched by the registry entry of its
///    foreground process and by its manager directory;
/// 2. a registry entry no terminal claimed is an agent of its own;
/// 3. a main transcript joins the agent holding its session, or a Codex
///    terminal by working directory and start time, or becomes an agent of
///    its own; a subagent transcript is an agent whose parent holds its
///    session;
/// 4. a macrod session enriches the agent holding its native session or its
///    transcript, and never stands alone;
/// 5. a run record enriches the terminal it names, or stands alone;
/// 6. parents link by hc parent, else the spawning terminal.
pub fn build_agents(facts: &Facts, now: Timestamp) -> Built {
    let mut built = Built::default();
    // Which agent holds each native session id, for transcripts and subagents.
    let mut session_owner: BTreeMap<String, AgentId> = BTreeMap::new();
    let session_by_pid: BTreeMap<u32, &Owned<ClaudeSessionFact>> = facts
        .claude_sessions
        .iter()
        .map(|(pid, owned)| (*pid, owned))
        .collect();

    for (address, owned) in &facts.terminals {
        let mut agent = terminal_agent(&owned.fact, now);
        agent.sources.insert(owned.source);
        built
            .owners
            .insert(FactKey::Terminal(address.clone()), agent.id.clone());

        let registry = owned
            .fact
            .foreground_pid
            .and_then(|pid| session_by_pid.get(&pid));
        if let Some(registry) = registry {
            merge_registry(&mut agent, registry);
            built
                .owners
                .insert(FactKey::ClaudeSession(registry.fact.pid), agent.id.clone());
            session_owner.insert(registry.fact.session_id.clone(), agent.id.clone());
        }

        let manager = owned
            .fact
            .manager_dir
            .as_ref()
            .and_then(|dir| facts.managers.get(dir));
        if let Some(manager) = manager {
            merge_manager(&mut agent, manager);
            built
                .owners
                .insert(FactKey::Manager(manager.fact.dir.clone()), agent.id.clone());
        }

        built.agents.insert(agent.id.clone(), agent);
    }

    // Registry entries no terminal claimed: plain Claude Code in a shell.
    for (pid, owned) in &facts.claude_sessions {
        if session_owner.contains_key(&owned.fact.session_id) {
            continue;
        }
        let id = AgentId::claude_session(&owned.fact.session_id);
        let name = owned
            .fact
            .name
            .clone()
            .unwrap_or_else(|| short_id(&owned.fact.session_id));
        let mut agent = Agent::new(id.clone(), AgentKind::Other, name);
        agent.program = Some(CLAUDE_PROGRAM.to_owned());
        merge_registry(&mut agent, owned);
        built
            .owners
            .insert(FactKey::ClaudeSession(*pid), id.clone());
        session_owner.insert(owned.fact.session_id.clone(), id.clone());
        built.agents.insert(id, agent);
    }

    join_transcripts(facts, &mut built, &mut session_owner, now);
    join_macrod_sessions(facts, &mut built, &session_owner);
    join_run_records(facts, &mut built);
    split_session_costs(facts, &mut built);
    link_parents(facts, &mut built);
    built
}

fn join_transcripts(
    facts: &Facts,
    built: &mut Built,
    session_owner: &mut BTreeMap<String, AgentId>,
    now: Timestamp,
) {
    let mut codex_terminals = codex_terminals(facts);

    // Main transcripts first, so subagents find their parent.
    let (mains, subagents): (Vec<_>, Vec<_>) = facts
        .transcripts
        .iter()
        .partition(|(key, _)| key.subagent.is_none());

    for (key, owned) in mains.into_iter().chain(subagents) {
        let transcript = &owned.fact;
        let owner = session_owner.get(&key.session).cloned().or_else(|| {
            (key.subagent.is_none() && key.program == TranscriptProgram::Codex)
                .then(|| claim_codex_terminal(&mut codex_terminals, transcript))
                .flatten()
        });

        let id = match (&key.subagent, owner) {
            (None, Some(owner)) => owner,
            (None, None) => {
                let id = transcript_agent_id(key);
                let program = match key.program {
                    TranscriptProgram::Claude => CLAUDE_PROGRAM,
                    TranscriptProgram::Codex => CODEX_PROGRAM,
                };
                let name = transcript
                    .title
                    .clone()
                    .unwrap_or_else(|| short_id(&key.session));
                let mut agent = Agent::new(id.clone(), AgentKind::Other, name);
                agent.program = Some(program.to_owned());
                // No terminal and no registry entry. With the registry
                // reporting, a Claude session missing from it has no
                // process; Codex has no registry, so an idle rollout is
                // taken as ended too.
                let ended = facts.registry_seen || key.program == TranscriptProgram::Codex;
                if ended {
                    agent.status = Status::Done;
                    agent.ended = transcript.last_at;
                }
                built.agents.insert(id.clone(), agent);
                id
            }
            (Some(subagent), parent) => {
                let id = AgentId::claude_subagent(&key.session, subagent);
                let name = transcript
                    .title
                    .clone()
                    .unwrap_or_else(|| short_id(subagent));
                let mut agent = Agent::new(id.clone(), AgentKind::Subagent, name);
                agent.program = Some(CLAUDE_PROGRAM.to_owned());
                agent.parent = parent;
                agent.status = Status::Done;
                agent.ended = transcript.last_at;
                built.agents.insert(id.clone(), agent);
                id
            }
        };
        if key.subagent.is_none() {
            session_owner.insert(key.session.clone(), id.clone());
        }

        if let Some(agent) = built.agents.get_mut(&id) {
            merge_transcript(agent, key, owned, now);
        }
        built.owners.insert(FactKey::Transcript(key.clone()), id);
    }
}

/// A live Codex terminal waiting for its rollout.
struct CodexTerminal {
    id: AgentId,
    cwd: Option<PathBuf>,
    created: Option<Timestamp>,
}

fn codex_terminals(facts: &Facts) -> Vec<CodexTerminal> {
    facts
        .terminals
        .values()
        .map(|owned| &owned.fact)
        .filter(|terminal| terminal.program.as_deref() == Some(CODEX_PROGRAM))
        .map(|terminal| CodexTerminal {
            id: AgentId::terminal(&terminal.address),
            cwd: terminal.cwd.clone(),
            created: terminal.created,
        })
        .collect()
}

/// The Codex terminal that wrote a rollout: same working directory, started
/// before the rollout's first record (with some slack), the latest such.
/// Each terminal claims at most one rollout.
fn claim_codex_terminal(
    terminals: &mut Vec<CodexTerminal>,
    transcript: &TranscriptState,
) -> Option<AgentId> {
    let first = transcript.first_at?;
    let cwd = transcript.cwd.as_ref()?;
    let (index, _) = terminals
        .iter()
        .enumerate()
        .filter(|(_, terminal)| terminal.cwd.as_ref() == Some(cwd))
        .filter_map(|(index, terminal)| Some((index, terminal.created?)))
        .filter(|(_, created)| *created <= first + CODEX_START_SLACK)
        .max_by_key(|(_, created)| *created)?;
    Some(terminals.swap_remove(index).id)
}

fn join_macrod_sessions(
    facts: &Facts,
    built: &mut Built,
    session_owner: &BTreeMap<String, AgentId>,
) {
    let by_transcript: BTreeMap<&PathBuf, &AgentId> = facts
        .transcripts
        .iter()
        .filter(|(key, _)| key.subagent.is_none())
        .filter_map(|(key, owned)| {
            let owner = built.owners.get(&FactKey::Transcript(key.clone()))?;
            Some((&owned.fact.path, owner))
        })
        .collect();

    let mut joined = Vec::new();
    for (id, owned) in &facts.macrod_sessions {
        let session = &owned.fact;
        let owner = session
            .native_id
            .as_ref()
            .and_then(|native| session_owner.get(native))
            .or_else(|| {
                session
                    .transcript
                    .as_ref()
                    .and_then(|path| by_transcript.get(path).copied())
            });
        let Some(owner) = owner.cloned() else {
            continue;
        };

        if let Some(agent) = built.agents.get_mut(&owner) {
            agent.sources.insert(owned.source);
            if agent.kind == AgentKind::Other {
                agent.kind = AgentKind::MacrodSession;
            }
            if agent.model.is_none() {
                agent.model.clone_from(&session.model);
            }
            if agent.cwd.is_none() {
                agent.cwd.clone_from(&session.cwd);
            }
            agent.started = earliest(agent.started, session.started);
        }
        joined.push((FactKey::MacrodSession(id.clone()), owner));
    }
    built.owners.extend(joined);
}

fn join_run_records(facts: &Facts, built: &mut Built) {
    for (id, owned) in &facts.run_records {
        let run = &owned.fact;
        // The record names its terminal by address or by name; the terminal
        // may instead carry the run id in a label.
        let terminal = facts.terminals.values().map(|owned| &owned.fact).find(|terminal| {
            let named = run
                .terminal
                .as_ref()
                .is_some_and(|name| *name == terminal.address || *name == terminal.name);
            named || terminal.run_id.as_ref() == Some(id)
        });

        let agent_id = match terminal {
            Some(terminal) => AgentId::terminal(&terminal.address),
            None => {
                let agent_id = AgentId::run(id);
                let name = run.label.clone().unwrap_or_else(|| id.clone());
                let mut agent = Agent::new(agent_id.clone(), AgentKind::WorkRun, name);
                let (status, detail) = run_status(run.status.as_deref());
                agent.status = status;
                agent.status_detail = detail;
                agent.pid = run.pid;
                agent.started = run.started;
                agent.last_activity = run.started;
                built.agents.insert(agent_id.clone(), agent);
                agent_id
            }
        };

        if let Some(agent) = built.agents.get_mut(&agent_id) {
            agent.sources.insert(owned.source);
            if agent.kind == AgentKind::Other {
                agent.kind = AgentKind::WorkRun;
            }
            if agent.task.is_none() {
                agent.task = run.task.as_deref().map(|task| clip(task, TASK_CHARS));
            }
            // The run's own cost file covers everything it ran.
            if let Some(cost) = run.cost {
                agent.cost = cost;
            }
        }
        built
            .owners
            .insert(FactKey::RunRecord(id.clone()), agent_id);
    }
}

/// A run record's status word as a status.
fn run_status(word: Option<&str>) -> (Status, Option<String>) {
    let status = match word {
        Some("running" | "started") => Status::Working,
        Some("done" | "succeeded" | "success" | "ok" | "finished") => Status::Done,
        Some("failed" | "error" | "errored") => Status::Failed,
        Some("killed" | "stopped" | "cancelled" | "canceled") => Status::Stopped,
        _ => Status::Idle,
    };
    (status, word.map(str::to_owned))
}

/// A session's reported total covers its subagents, which are rows of their
/// own: the main row keeps the rest, so rows add up to the reported total.
/// Subtracting estimates makes the main row an estimate.
fn split_session_costs(facts: &Facts, built: &mut Built) {
    for (key, owned) in &facts.transcripts {
        if key.subagent.is_none() {
            continue;
        }
        let main = TranscriptKey {
            subagent: None,
            ..key.clone()
        };
        let reported_by_main = facts
            .transcripts
            .get(&main)
            .is_some_and(|main| main.fact.reported.is_some());
        let Some(subagent_usd) = owned.fact.cost().usd() else {
            continue;
        };
        if !reported_by_main {
            continue;
        }
        let Some(main_id) = built.owners.get(&FactKey::Transcript(main)).cloned() else {
            continue;
        };

        if let Some(agent) = built.agents.get_mut(&main_id)
            && let Some(usd) = agent.cost.usd()
        {
            agent.cost = Cost::Estimated((usd - subagent_usd).max(0.0));
        }
    }
}

const CLAUDE_PROGRAM: &str = "claude-code";
const CODEX_PROGRAM: &str = "codex";

fn transcript_agent_id(key: &TranscriptKey) -> AgentId {
    match key.program {
        TranscriptProgram::Claude => AgentId::claude_session(&key.session),
        TranscriptProgram::Codex => AgentId::codex_session(&key.session),
    }
}

fn terminal_agent(terminal: &TerminalFact, now: Timestamp) -> Agent {
    let kind = terminal.kind.unwrap_or(AgentKind::Other);
    let mut agent = Agent::new(
        AgentId::terminal(&terminal.address),
        kind,
        terminal.name.clone(),
    );
    agent.task = terminal.goal.as_deref().map(|goal| clip(goal, TASK_CHARS));
    let (status, detail) = terminal_status(terminal);
    agent.status = status;
    agent.status_detail = detail;
    agent.program.clone_from(&terminal.program);
    agent.model.clone_from(&terminal.model);
    agent.cwd.clone_from(&terminal.cwd);
    agent.space.clone_from(&terminal.space);
    agent.tags.clone_from(&terminal.tags);
    agent.terminal = Some(terminal.address.clone());
    agent.pid = terminal.foreground_pid;
    agent.started = terminal.created;
    agent.ended = terminal.finished;
    agent.last_activity = terminal
        .finished
        .or(terminal.created)
        .filter(|at| *at <= now);
    agent
}

/// Status from hc, by the rules in the plan: a finished terminal is stopped,
/// done or failed by its reason and exit code; a live one follows its activity,
/// with the waiting label above idle.
fn terminal_status(terminal: &TerminalFact) -> (Status, Option<String>) {
    if terminal.state == TerminalState::Finished {
        return match &terminal.finish_reason {
            Some(FinishReason::Killed) => (Status::Stopped, Some("killed".to_owned())),
            Some(FinishReason::StoppedByRestart) => {
                (Status::Stopped, Some("stopped by restart".to_owned()))
            }
            _ if terminal.exit_code == Some(0) => (Status::Done, None),
            Some(FinishReason::Other(reason)) => (Status::Failed, Some(reason.clone())),
            _ => (
                Status::Failed,
                terminal.exit_code.map(|code| format!("exit {code}")),
            ),
        };
    }

    match terminal.activity {
        Some(TerminalActivity::Working) => (Status::Working, terminal.status_message.clone()),
        Some(TerminalActivity::Blocked) => (Status::Blocked, terminal.status_message.clone()),
        Some(TerminalActivity::Error) => (Status::Blocked, Some("error".to_owned())),
        _ if terminal.waiting => (Status::Waiting, terminal.status_message.clone()),
        _ => (Status::Idle, None),
    }
}

fn merge_registry(agent: &mut Agent, registry: &Owned<ClaudeSessionFact>) {
    agent.sources.insert(registry.source);
    agent.session = Some(registry.fact.session_id.clone());
    agent.pid = agent.pid.or(Some(registry.fact.pid));
    if agent.cwd.is_none() {
        agent.cwd.clone_from(&registry.fact.cwd);
    }
    if agent.terminal.is_none() {
        agent.status = if registry.fact.busy {
            Status::Working
        } else {
            Status::Idle
        };
    }
}

fn merge_manager(agent: &mut Agent, manager: &Owned<ManagerFact>) {
    agent.sources.insert(manager.source);
    agent.kind = AgentKind::Manager;
    if manager.fact.state.is_some() && agent.status_detail.is_none() {
        agent.status_detail.clone_from(&manager.fact.state);
    }
    if agent.task.is_none() {
        agent.task = manager
            .fact
            .goal
            .as_deref()
            .map(|goal| clip(goal, TASK_CHARS));
    }
}

fn merge_transcript(
    agent: &mut Agent,
    key: &TranscriptKey,
    owned: &Owned<TranscriptState>,
    now: Timestamp,
) {
    let transcript = &owned.fact;
    agent.sources.insert(owned.source);
    agent.transcript = Some(transcript.path.clone());
    if agent.session.is_none() {
        agent.session = Some(key.session.clone());
    }
    if transcript.model.is_some() {
        agent.model.clone_from(&transcript.model);
    }
    if agent.cwd.is_none() {
        agent.cwd.clone_from(&transcript.cwd);
    }
    if transcript.branch.is_some() {
        agent.branch.clone_from(&transcript.branch);
    }
    if agent.task.is_none() {
        agent.task = transcript
            .title
            .as_deref()
            .map(|title| clip(title, TASK_CHARS));
    }

    agent.turns += transcript.turns;
    agent.tool_calls += transcript.tool_calls;
    agent.tool_errors += transcript.tool_errors;
    agent.tokens.add(transcript.tokens);
    agent.cost = agent.cost.plus(transcript.cost());
    if let Some(doing) = transcript.open_tools.values().next_back() {
        agent.doing = Some(doing.clone());
    }
    agent.started = earliest(agent.started, transcript.first_at);
    agent.last_activity = latest(agent.last_activity, transcript.last_at);

    let current_minute = minute_of(now);
    for (minute, counts) in &transcript.minutes {
        let minutes_ago = (current_minute - *minute).num_minutes();
        let Ok(minutes_ago) = usize::try_from(minutes_ago) else {
            continue;
        };
        if minutes_ago < ACTIVITY_MINUTES {
            let slot = &mut agent.activity[ACTIVITY_MINUTES - 1 - minutes_ago];
            let count = counts.turns + counts.tools;
            *slot = slot.saturating_add(u16::try_from(count).unwrap_or(u16::MAX));
        }
        if now - *minute < HISTORY {
            agent.failures += counts.errors;
        }
    }

    // With no terminal, a recently written transcript means the agent is working.
    let recently_written = transcript
        .last_at
        .is_some_and(|last| now - last <= TRANSCRIPT_WORKING_WINDOW);
    if agent.terminal.is_none() && recently_written {
        agent.status = Status::Working;
        agent.ended = None;
    }
}

fn link_parents(facts: &Facts, built: &mut Built) {
    for (address, owned) in &facts.terminals {
        let parent = owned
            .fact
            .parent
            .as_ref()
            .or(owned.fact.spawned_by.as_ref())
            .map(|parent| AgentId::terminal(parent))
            .filter(|parent| built.agents.contains_key(parent));
        if let Some(agent) = built.agents.get_mut(&AgentId::terminal(address)) {
            agent.parent = parent;
        }
    }

    let mut children: BTreeMap<AgentId, Vec<AgentId>> = BTreeMap::new();
    for agent in built.agents.values_mut() {
        if agent.status == Status::Failed {
            agent.failures += 1;
        }
        if let Some(parent) = &agent.parent {
            children
                .entry(parent.clone())
                .or_default()
                .push(agent.id.clone());
        }
    }
    for (parent, ids) in children {
        if let Some(agent) = built.agents.get_mut(&parent) {
            agent.children = ids;
        }
    }
}

fn minute_of(at: Timestamp) -> Timestamp {
    at.duration_trunc(TimeDelta::minutes(1)).unwrap_or(at)
}

fn earliest(a: Option<Timestamp>, b: Option<Timestamp>) -> Option<Timestamp> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

fn latest(a: Option<Timestamp>, b: Option<Timestamp>) -> Option<Timestamp> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

fn clip(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let mut clipped: String = text.chars().take(max_chars - 1).collect();
    clipped.push('…');
    clipped
}
