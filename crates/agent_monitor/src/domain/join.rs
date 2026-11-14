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

/// A transcript written this recently counts as working when no terminal says otherwise.
const TRANSCRIPT_WORKING_WINDOW: TimeDelta = TimeDelta::seconds(90);

/// How far back the per-minute counts reach.
const HISTORY: TimeDelta = TimeDelta::hours(24);

/// Longest task text kept on a row.
const TASK_CHARS: usize = 160;

/// Longest `doing` text kept on a row.
const DOING_CHARS: usize = 80;

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
    cost: Cost,
    first_at: Option<Timestamp>,
    last_at: Option<Timestamp>,
    minutes: BTreeMap<Timestamp, MinuteCounts>,
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
            cost: Cost::Unpriced,
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
                }
                TranscriptEventKind::Cost(cost) => {
                    // A reported cost is a running total; the minute gets the increase.
                    let increase = cost.usd().unwrap_or(0.0) - self.cost.usd().unwrap_or(0.0);
                    minute.cost_usd += increase.max(0.0);
                    self.cost = *cost;
                }
            }
        }

        let horizon = now - HISTORY;
        self.minutes.retain(|minute, _| *minute >= horizon);
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
pub fn minute_counts(facts: &Facts, now: Timestamp) -> BTreeMap<Timestamp, MinuteCounts> {
    let horizon = now - HISTORY;
    let mut counts: BTreeMap<Timestamp, MinuteCounts> = BTreeMap::new();
    for transcript in facts.transcripts.values() {
        for (minute, minute_counts) in transcript.fact.minutes.range(horizon..) {
            let total = counts.entry(*minute).or_default();
            total.turns += minute_counts.turns;
            total.tools += minute_counts.tools;
            total.errors += minute_counts.errors;
            total.tokens += minute_counts.tokens;
            total.cost_usd += minute_counts.cost_usd;
        }
    }
    counts
}

/// Joins every fact into agents.
///
/// Covers terminals, the Claude registry's pid join, transcripts, subagents,
/// manager enrichment and parents. Macrod sessions, run records and the Codex
/// cwd-and-time join are filed but not yet joined.
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

    // Main transcripts first, so subagents find their parent.
    let (mains, subagents): (Vec<_>, Vec<_>) = facts
        .transcripts
        .iter()
        .partition(|(key, _)| key.subagent.is_none());

    for (key, owned) in mains.into_iter().chain(subagents) {
        let id = match (&key.subagent, session_owner.get(&key.session)) {
            (None, Some(owner)) => owner.clone(),
            (None, None) => {
                let id = transcript_agent_id(key);
                let program = match key.program {
                    TranscriptProgram::Claude => CLAUDE_PROGRAM,
                    TranscriptProgram::Codex => CODEX_PROGRAM,
                };
                let name = owned
                    .fact
                    .title
                    .clone()
                    .unwrap_or_else(|| short_id(&key.session));
                let mut agent = Agent::new(id.clone(), AgentKind::Other, name);
                agent.program = Some(program.to_owned());
                session_owner.insert(key.session.clone(), id.clone());
                built.agents.insert(id.clone(), agent);
                id
            }
            (Some(subagent), parent) => {
                let id = AgentId::claude_subagent(&key.session, subagent);
                let name = owned
                    .fact
                    .title
                    .clone()
                    .unwrap_or_else(|| short_id(subagent));
                let mut agent = Agent::new(id.clone(), AgentKind::Subagent, name);
                agent.program = Some(CLAUDE_PROGRAM.to_owned());
                agent.parent = parent.cloned();
                built.agents.insert(id.clone(), agent);
                id
            }
        };

        if let Some(agent) = built.agents.get_mut(&id) {
            merge_transcript(agent, key, owned, now);
        }
        built.owners.insert(FactKey::Transcript(key.clone()), id);
    }

    link_parents(facts, &mut built);
    built
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
    agent.cost = agent.cost.plus(transcript.cost);
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
