//! The viewer's mirror of the collector: agents, the tape, totals and source
//! health, updated by [`ViewState::apply`] with a dirty flag, plus the open
//! agent's transcript.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashSet, VecDeque};

use agent_monitor::domain::model::{
    Agent, AgentId, AgentKind, Cost, Severity, Snapshot, SourceHealth, SourceKind, Status,
    TapeEvent, TapeKind, Timestamp, Totals, TranscriptItem, Update, UpdateKind,
};

use crate::body::BodyPane;

/// Tape lines kept in the viewer.
pub const TAPE_CAPACITY: usize = 2000;

/// Transcript items kept for the open agent.
pub const TRANSCRIPT_CAPACITY: usize = 400;

/// The state of the link to the collector.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Link {
    /// Not yet connected.
    Connecting,
    /// Receiving updates.
    Live,
    /// Lost; retrying.
    Reconnecting(String),
    /// The collector speaks a newer protocol.
    Incompatible(u32),
}

/// One row of the FAILURES pane.
#[derive(Clone, Debug, PartialEq)]
pub struct Failure {
    /// When.
    pub at: Timestamp,
    /// Which agent.
    pub agent: AgentId,
    /// `tool` for a failed call, `agent` for a failed agent.
    pub what: &'static str,
    /// The tape text.
    pub detail: String,
}

/// One row of the SOURCES pane.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceRow<'a> {
    /// Which source.
    pub source: SourceKind,
    /// Its reported health, if it reported any.
    pub health: Option<&'a SourceHealth>,
    /// Agents it contributed to.
    pub agents: usize,
}

/// The transcript tail of the agent open in the drill-in page.
#[derive(Clone, Debug, PartialEq)]
pub struct Transcript {
    /// Whose transcript.
    pub agent: AgentId,
    /// Items, oldest first.
    pub items: VecDeque<TranscriptItem>,
    /// Why it could not be read, when it could not.
    pub error: Option<String>,
}

/// What the viewer knows, mirrored from the collector's updates.
pub struct ViewState {
    /// Every agent by id.
    pub agents: BTreeMap<AgentId, Agent>,
    /// Tape lines, oldest first.
    pub tape: VecDeque<TapeEvent>,
    /// Board numbers.
    pub totals: Totals,
    /// Source health by source.
    pub sources: BTreeMap<SourceKind, SourceHealth>,
    /// The sequence number of the last update applied.
    pub seq: u64,
    /// The collector link.
    pub link: Link,
    /// When the collector was last heard from.
    pub heartbeat: Option<Timestamp>,
    /// The open agent's transcript.
    pub transcript: Option<Transcript>,
    /// The BODY pane.
    pub body: Box<dyn BodyPane>,
    /// Whether anything changed since the last draw.
    pub dirty: bool,
}

impl ViewState {
    /// An empty view drawing its BODY pane with `body`.
    pub fn new(body: Box<dyn BodyPane>) -> Self {
        Self {
            agents: BTreeMap::new(),
            tape: VecDeque::new(),
            totals: Totals::default(),
            sources: BTreeMap::new(),
            seq: 0,
            link: Link::Connecting,
            heartbeat: None,
            transcript: None,
            body,
            dirty: true,
        }
    }

    /// Applies one update. A snapshot replaces everything; any other update
    /// whose sequence number is not above the last one applied is dropped,
    /// so updates queued before a fresh snapshot cannot rewind it.
    pub fn apply(&mut self, update: Update) {
        if let UpdateKind::Snapshot(snapshot) = update.kind {
            self.replace(snapshot);
            self.seq = update.seq;
            self.link = Link::Live;
            self.dirty = true;
            return;
        }

        if update.seq <= self.seq {
            return;
        }
        self.seq = update.seq;
        self.link = Link::Live;

        match update.kind {
            UpdateKind::Snapshot(_) => {}
            UpdateKind::Upsert(agent) => {
                self.agents.insert(agent.id.clone(), agent);
            }
            UpdateKind::Removed(id) => {
                self.agents.remove(&id);
            }
            UpdateKind::Event(event) => {
                self.body.event(&event);
                self.push_tape(event);
            }
            UpdateKind::Totals(totals) => {
                self.body.totals(&totals);
                self.totals = totals;
            }
            UpdateKind::Source(health) => {
                self.sources.insert(health.source, health);
            }
            UpdateKind::Heartbeat(at) => {
                self.heartbeat = Some(at);
                return;
            }
        }
        self.dirty = true;
    }

    fn replace(&mut self, snapshot: Snapshot) {
        self.agents = snapshot
            .agents
            .into_iter()
            .map(|agent| (agent.id.clone(), agent))
            .collect();
        self.tape.clear();
        for event in snapshot.tape {
            self.body.event(&event);
            self.push_tape(event);
        }
        self.body.totals(&snapshot.totals);
        self.totals = snapshot.totals;
        self.sources = snapshot
            .sources
            .into_iter()
            .map(|health| (health.source, health))
            .collect();
    }

    fn push_tape(&mut self, event: TapeEvent) {
        if self.tape.len() == TAPE_CAPACITY {
            self.tape.pop_front();
        }
        self.tape.push_back(event);
    }

    /// Marks the link state.
    pub fn set_link(&mut self, link: Link) {
        if self.link != link {
            self.link = link;
            self.dirty = true;
        }
    }

    /// Starts following `agent`'s transcript, dropping any other.
    pub fn open_transcript(&mut self, agent: AgentId) {
        self.transcript = Some(Transcript {
            agent,
            items: VecDeque::new(),
            error: None,
        });
        self.dirty = true;
    }

    /// Adds a transcript item if it belongs to the agent still open.
    pub fn transcript_item(&mut self, agent: &AgentId, item: TranscriptItem) {
        let Some(transcript) = self.transcript.as_mut() else {
            return;
        };
        if transcript.agent != *agent {
            return;
        }
        if transcript.items.len() == TRANSCRIPT_CAPACITY {
            transcript.items.pop_front();
        }
        transcript.items.push_back(item);
        self.dirty = true;
    }

    /// Records why the open agent's transcript cannot be read.
    pub fn transcript_error(&mut self, agent: &AgentId, error: String) {
        if let Some(transcript) = self.transcript.as_mut()
            && transcript.agent == *agent {
                transcript.error = Some(error);
                self.dirty = true;
            }
    }

    /// The agent's display name or, once it is gone, the last part of its id.
    pub fn name_of(&self, id: &AgentId) -> String {
        match self.agents.get(id) {
            Some(agent) => agent.name.clone(),
            None => {
                let id = id.as_str();
                let start = id.rfind(['/', ':']).map_or(0, |index| index + 1);
                id.get(start..).unwrap_or(id).to_owned()
            }
        }
    }

    /// Agents for the AGENTS pane: live ones (ended agents last), sorted
    /// Working, Blocked, Waiting, Idle, then by latest activity, filtered.
    pub fn sorted_agents(&self, filter: &Filter) -> Vec<&Agent> {
        let mut agents: Vec<&Agent> = self
            .agents
            .values()
            .filter(|agent| filter.matches_agent(agent))
            .collect();
        agents.sort_by(|a, b| {
            a.status
                .cmp(&b.status)
                .then_with(|| b.last_activity.cmp(&a.last_activity))
                .then_with(|| a.id.cmp(&b.id))
        });
        agents
    }

    /// Tape lines newest first, filtered.
    pub fn tape_newest_first<'a>(&'a self, filter: &'a Filter) -> impl Iterator<Item = &'a TapeEvent> + 'a {
        self.tape
            .iter()
            .rev()
            .filter(move |event| filter.matches_event(event, self.agents.get(&event.agent)))
    }

    /// The FAILURES rows, newest first: tool errors, failures and
    /// error-severity lines from the tape, plus failed agents with no such
    /// line.
    pub fn failures(&self, filter: &Filter) -> Vec<Failure> {
        let mut rows: Vec<Failure> = Vec::new();
        let mut seen: HashSet<&AgentId> = HashSet::new();

        for event in self.tape.iter().rev() {
            let is_failure = matches!(event.kind, TapeKind::ToolError | TapeKind::Failure)
                || event.severity == Severity::Error;
            if !is_failure || !filter.matches_event(event, self.agents.get(&event.agent)) {
                continue;
            }
            let what = if event.kind == TapeKind::ToolError {
                "tool"
            } else {
                seen.insert(&event.agent);
                "agent"
            };
            rows.push(Failure {
                at: event.at,
                agent: event.agent.clone(),
                what,
                detail: event.text.clone(),
            });
        }

        for agent in self.agents.values() {
            if agent.status != Status::Failed || seen.contains(&agent.id) {
                continue;
            }
            if !filter.matches_agent(agent) {
                continue;
            }
            let Some(at) = agent.ended.or(agent.last_activity) else {
                continue;
            };
            rows.push(Failure {
                at,
                agent: agent.id.clone(),
                what: "agent",
                detail: agent
                    .status_detail
                    .clone()
                    .unwrap_or_else(|| String::from("failed")),
            });
        }

        rows.sort_by(|a, b| b.at.cmp(&a.at));
        rows
    }

    /// Spend by agent kind, largest first, with whether any part is an
    /// estimate.
    pub fn spend_by_kind(&self) -> Vec<(AgentKind, Cost)> {
        let mut by_kind: Vec<(AgentKind, Cost)> = Vec::new();
        for agent in self.agents.values() {
            if agent.cost.usd().is_none() {
                continue;
            }
            match by_kind.iter_mut().find(|(kind, _)| *kind == agent.kind) {
                Some((_, cost)) => *cost = cost.plus(agent.cost),
                None => by_kind.push((agent.kind, agent.cost)),
            }
        }
        by_kind.sort_by(|a, b| {
            let a = a.1.usd().unwrap_or(0.0);
            let b = b.1.usd().unwrap_or(0.0);
            b.total_cmp(&a)
        });
        by_kind
    }

    /// The agent's last `count` tape lines, newest first.
    pub fn agent_tape(&self, id: &AgentId, count: usize) -> Vec<&TapeEvent> {
        self.tape
            .iter()
            .rev()
            .filter(|event| event.agent == *id)
            .take(count)
            .collect()
    }

    /// The SOURCES rows: every source that reported health or contributed to
    /// an agent, in display order, with how many agents it contributed to.
    pub fn source_rows(&self) -> Vec<SourceRow<'_>> {
        SourceKind::ALL
            .into_iter()
            .filter_map(|source| {
                let agents = self
                    .agents
                    .values()
                    .filter(|agent| agent.sources.contains(source))
                    .count();
                let health = self.sources.get(&source);
                (health.is_some() || agents > 0).then_some(SourceRow {
                    source,
                    health,
                    agents,
                })
            })
            .collect()
    }

    /// Whether any agent is working, so status squares blink.
    pub fn any_working(&self) -> bool {
        self.agents
            .values()
            .any(|agent| agent.status == Status::Working)
    }
}

/// Row filtering: command-line words (each must match the kind, the status,
/// or part of the name, task or program) and a find query (part of the
/// name, task, doing or tape text).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Filter {
    /// Lowercase command-line words.
    pub words: Vec<String>,
    /// Lowercase find query.
    pub find: String,
}

impl Filter {
    /// Whether nothing filters.
    pub fn is_empty(&self) -> bool {
        self.words.is_empty() && self.find.is_empty()
    }

    fn word_matches(word: &str, agent: &Agent) -> bool {
        let status = format!("{:?}", agent.status).to_lowercase();
        agent.kind.label() == word
            || status == word
            || agent.name.to_lowercase().contains(word)
            || agent
                .task
                .as_deref()
                .is_some_and(|task| task.to_lowercase().contains(word))
            || agent
                .program
                .as_deref()
                .is_some_and(|program| program.to_lowercase().contains(word))
    }

    fn find_matches(&self, agent: &Agent) -> bool {
        let find = self.find.as_str();
        agent.name.to_lowercase().contains(find)
            || agent
                .task
                .as_deref()
                .is_some_and(|task| task.to_lowercase().contains(find))
            || agent
                .doing
                .as_deref()
                .is_some_and(|doing| doing.to_lowercase().contains(find))
    }

    /// Whether an agent row shows.
    pub fn matches_agent(&self, agent: &Agent) -> bool {
        let words = self
            .words
            .iter()
            .all(|word| Self::word_matches(word, agent));
        words && (self.find.is_empty() || self.find_matches(agent))
    }

    /// Whether a tape line shows; `agent` is its agent's row, if known.
    pub fn matches_event(&self, event: &TapeEvent, agent: Option<&Agent>) -> bool {
        if self.is_empty() {
            return true;
        }

        let words = match agent {
            Some(agent) => self
                .words
                .iter()
                .all(|word| Self::word_matches(word, agent)),
            None => self.words.is_empty(),
        };
        let find = self.find.is_empty()
            || event.text.to_lowercase().contains(&self.find)
            || agent.is_some_and(|agent| self.find_matches(agent));
        words && find
    }
}
