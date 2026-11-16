//! The viewer's mirror of the collector: agents, the tape, totals, source
//! health, pull requests and repository graphs, updated by
//! [`ViewState::apply`] with a dirty flag, plus the open agent's transcript.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use chrono::TimeDelta;

use agent_monitor::domain::model::{
    Agent, AgentId, AgentKind, CiState, Cost, Lane, LaneBase, Mergeable, Oid, Pr, PrId, PrState,
    RepoGraph, RepoId, ReviewState, Severity, Snapshot, SourceHealth, SourceKind, Status,
    TapeEvent, TapeKind, Timestamp, Totals, TranscriptItem, Update, UpdateKind,
};

use crate::body::BodyPane;

/// Tape lines kept in the viewer.
pub const TAPE_CAPACITY: usize = 2000;

/// How long an ended agent stays listed without the all toggle.
pub const RECENTLY_ENDED: TimeDelta = TimeDelta::minutes(10);

/// The window of the FAILURES pane.
pub const FAILURE_WINDOW: TimeDelta = TimeDelta::hours(24);

/// Transcript items kept for the open agent.
pub const TRANSCRIPT_CAPACITY: usize = 400;

/// How long a commit that arrived in a delta counts as fresh.
pub const FRESH_FOR: TimeDelta = TimeDelta::seconds(30);

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
    /// `tool` for a failed call, `ci` for a pull request's failed CI,
    /// `agent` for a failed agent.
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
    /// Every pull request by id.
    pub prs: BTreeMap<PrId, Pr>,
    /// Every repository graph by id.
    pub repos: BTreeMap<RepoId, RepoGraph>,
    /// Commits that arrived in a delta after the first snapshot, with when
    /// they arrived (by the view's own clock, [`ViewState::now`], or the
    /// commit's time if later), so the CHANGES page can animate landings.
    pub fresh: HashMap<Oid, Timestamp>,
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
            prs: BTreeMap::new(),
            repos: BTreeMap::new(),
            fresh: HashMap::new(),
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
            UpdateKind::PrUpsert(pr) => {
                self.prs.insert(pr.id.clone(), pr);
            }
            UpdateKind::PrRemoved(id) => {
                self.prs.remove(&id);
            }
            UpdateKind::RepoUpsert(graph) => self.upsert_repo(graph),
            UpdateKind::RepoRemoved(id) => {
                self.repos.remove(&id);
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
        // Past lines: counted, never animated, so a (re)snapshot fires no burst.
        self.body.history(&snapshot.tape);
        for event in snapshot.tape {
            self.push_tape(event);
        }
        self.body.totals(&snapshot.totals);
        self.totals = snapshot.totals;
        self.sources = snapshot
            .sources
            .into_iter()
            .map(|health| (health.source, health))
            .collect();
        self.prs = snapshot
            .prs
            .into_iter()
            .map(|pr| (pr.id.clone(), pr))
            .collect();
        self.repos = snapshot
            .repos
            .into_iter()
            .map(|graph| (graph.id.clone(), graph))
            .collect();
        // A (re)snapshot animates nothing.
        self.fresh.clear();
    }

    /// Replaces a graph and marks the commits it gained as fresh: new
    /// commits on the trunk or on a lane it already had, and any commit
    /// newer than everything it had. A lane that only now enters the graph
    /// (an agent moved onto an old branch) brings its old commits quietly.
    fn upsert_repo(&mut self, graph: RepoGraph) {
        if let Some(previous) = self.repos.get(&graph.id) {
            let known: HashSet<&Oid> = graph_commits(previous).map(|commit| &commit.oid).collect();
            let lanes: HashSet<&str> = previous
                .lanes
                .iter()
                .map(|lane| lane.branch.as_str())
                .collect();
            let newest = graph_commits(previous).map(|commit| commit.at).max();
            let gained = graph.trunk.commits.iter().chain(
                graph
                    .lanes
                    .iter()
                    .filter(|lane| lanes.contains(lane.branch.as_str()))
                    .flat_map(|lane| lane.commits.iter()),
            );
            let newer =
                graph_commits(&graph).filter(|commit| newest.is_none_or(|at| commit.at > at));
            let now = self.now();
            for commit in gained.chain(newer) {
                if !known.contains(&commit.oid) {
                    let arrived = now.map_or(commit.at, |now| now.max(commit.at));
                    self.fresh.insert(commit.oid.clone(), arrived);
                }
            }
            if let Some(newest) = self.fresh.values().max().copied() {
                self.fresh.retain(|_, at| *at > newest - FRESH_FOR);
            }
        }
        self.repos.insert(graph.id.clone(), graph);
    }

    /// Forgets commits that arrived more than [`FRESH_FOR`] before `now`,
    /// so the page stops animating once their glitch has played.
    pub fn prune_fresh(&mut self, now: Timestamp) {
        self.fresh.retain(|_, at| *at > now - FRESH_FOR);
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
            && transcript.agent == *agent
        {
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

    /// The latest time the view has seen: the collector's heartbeat, the
    /// newest tape line or the newest agent activity. Recency rules use it
    /// instead of the wall clock, so they follow the data.
    pub fn now(&self) -> Option<Timestamp> {
        let tape = self.tape.back().map(|event| event.at);
        let activity = self
            .agents
            .values()
            .filter_map(|agent| agent.last_activity)
            .max();
        [self.heartbeat, tape, activity].into_iter().flatten().max()
    }

    /// Whether an agent is listed without the all toggle: it has not ended,
    /// or it ended within the last few minutes so its finish is still seen.
    pub fn is_current(&self, agent: &Agent, now: Option<Timestamp>) -> bool {
        if !agent.status.is_final() {
            return true;
        }
        let ended = agent.ended.or(agent.last_activity);
        match (ended, now) {
            (Some(ended), Some(now)) => ended >= now - RECENTLY_ENDED,
            _ => false,
        }
    }

    /// Agents for the AGENTS pane and the wall, sorted Working, Blocked,
    /// Waiting, Idle, then ended, each by latest activity. Without
    /// [`Filter::all`] only current agents are listed.
    pub fn sorted_agents(&self, filter: &Filter) -> Vec<&Agent> {
        let now = self.now();
        let mut agents: Vec<&Agent> = self
            .agents
            .values()
            .filter(|agent| filter.all || self.is_current(agent, now))
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
    pub fn tape_newest_first<'a>(
        &'a self,
        filter: &'a Filter,
    ) -> impl Iterator<Item = &'a TapeEvent> + 'a {
        self.tape
            .iter()
            .rev()
            .filter(move |event| filter.matches_event(event, self.agents.get(&event.agent)))
    }

    /// The FAILURES rows, newest first: tool errors, failures and
    /// error-severity lines from the tape; failed agents with no such line;
    /// and, per agent, one row for tool errors older than the tape holds,
    /// so the rows add up to the board's error count.
    pub fn failures(&self, filter: &Filter) -> Vec<Failure> {
        let mut rows: Vec<Failure> = Vec::new();
        let mut seen: HashSet<&AgentId> = HashSet::new();
        let mut tool_lines: HashMap<&AgentId, u32> = HashMap::new();

        for event in self.tape.iter().rev() {
            let is_failure = matches!(event.kind, TapeKind::ToolError | TapeKind::Failure)
                || event.severity == Severity::Error;
            if !is_failure || !filter.matches_event(event, self.agents.get(&event.agent)) {
                continue;
            }
            let what = if event.kind == TapeKind::ToolError {
                *tool_lines.entry(&event.agent).or_default() += 1;
                "tool"
            } else if event.kind == TapeKind::PrCiFailed {
                "ci"
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

        // Only agents active inside the window add rows of their own, so
        // hundreds of old sessions do not bury today's failures.
        let since = self.now().map(|now| now - FAILURE_WINDOW);
        for agent in self.agents.values() {
            if !filter.matches_agent(agent) {
                continue;
            }
            let Some(at) = agent.ended.or(agent.last_activity) else {
                continue;
            };
            if since.is_some_and(|since| at < since) {
                continue;
            }

            let on_tape = tool_lines.get(&agent.id).copied().unwrap_or(0);
            let earlier = agent.tool_errors.saturating_sub(on_tape);
            if earlier > 0 {
                let noun = if earlier == 1 {
                    "tool error"
                } else {
                    "tool errors"
                };
                rows.push(Failure {
                    at: agent.started.unwrap_or(at),
                    agent: agent.id.clone(),
                    what: "tool",
                    detail: format!("{earlier} earlier {noun}"),
                });
            }

            if agent.status != Status::Failed || seen.contains(&agent.id) {
                continue;
            }
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

    /// Today's spend by agent kind, largest first, from the collector's
    /// totals: the same window as the day total, so the rows add up to it.
    pub fn spend_by_kind(&self) -> Vec<(AgentKind, Cost)> {
        self.totals
            .spend_by_kind
            .iter()
            .map(|(kind, usd)| (*kind, Cost::Estimated(*usd)))
            .collect()
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

    /// Pull requests for the PRS pane: failing CI first, then open ones
    /// before merged and closed, each newest first. The
    /// find query match the title, repository, branch, state or an agent's
    /// name.
    pub fn sorted_prs(&self, filter: &Filter) -> Vec<&Pr> {
        let mut prs: Vec<&Pr> = self
            .prs
            .values()
            .filter(|pr| filter.matches_pr(pr, |id| self.name_of(id)))
            .collect();
        let rank = |pr: &Pr| {
            let failing = pr.ci == CiState::Failed && !pr.state.is_final();
            (!failing, pr.state.is_final())
        };
        prs.sort_by(|a, b| {
            rank(a)
                .cmp(&rank(b))
                .then_with(|| {
                    b.updated_at
                        .or(b.opened_at)
                        .cmp(&a.updated_at.or(a.opened_at))
                })
                .then_with(|| b.number.cmp(&a.number))
        });
        prs
    }

    /// The agent a pull request row opens: its author, else its first agent.
    pub fn pr_agent(pr: &Pr) -> Option<&AgentId> {
        pr.author_agent.as_ref().or(pr.agents.first())
    }

    /// An agent's pull requests that the view holds, newest first.
    pub fn agent_prs(&self, agent: &Agent) -> Vec<&Pr> {
        agent.prs.iter().filter_map(|id| self.prs.get(id)).collect()
    }

    /// Whether any agent is working, so status squares blink.
    pub fn any_working(&self) -> bool {
        self.agents
            .values()
            .any(|agent| agent.status == Status::Working)
    }
}

/// Every commit a graph carries: the trunk's and each lane's.
fn graph_commits(graph: &RepoGraph) -> impl Iterator<Item = &agent_monitor::domain::model::Commit> {
    graph
        .trunk
        .commits
        .iter()
        .chain(graph.lanes.iter().flat_map(|lane| lane.commits.iter()))
}

/// How the CHANGES page orders lanes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LaneSort {
    /// By fork, newest fork nearest the trunk, stacks kept together, so no
    /// fork line crosses a lane.
    #[default]
    Fork,
    /// Lanes needing attention first (failing CI, conflicts, changes
    /// requested), then by fork; lines may cross.
    Attention,
}

/// Why a lane wants a look, worst first; `None` when it does not.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Attention {
    /// Its pull request's CI failed.
    Failing,
    /// Its pull request conflicts with the base.
    Conflicts,
    /// A review asked for changes.
    ChangesRequested,
}

impl ViewState {
    /// The repositories in tab order: the most working agents, then the
    /// newest commit.
    pub fn repo_tabs(&self) -> Vec<&RepoGraph> {
        let mut repos: Vec<&RepoGraph> = self.repos.values().collect();
        repos.sort_by_key(|graph| {
            let working = self
                .repo_agents(graph)
                .filter(|agent| agent.status == Status::Working)
                .count();
            let newest = graph
                .lanes
                .iter()
                .filter_map(|lane| lane.tip().map(|tip| tip.at))
                .max();
            (
                std::cmp::Reverse(working),
                std::cmp::Reverse(newest),
                graph.name.clone(),
            )
        });
        repos
    }

    /// Every agent drawn in a repository: on the trunk or on a lane.
    pub fn repo_agents<'a>(&'a self, graph: &'a RepoGraph) -> impl Iterator<Item = &'a Agent> + 'a {
        graph
            .trunk_agents
            .iter()
            .chain(graph.lanes.iter().flat_map(|lane| lane.agents.iter()))
            .filter_map(|id| self.agents.get(id))
    }

    /// A lane's pull request, when the view holds it.
    pub fn lane_pr(&self, lane: &Lane) -> Option<&Pr> {
        lane.pr.as_ref().and_then(|id| self.prs.get(id))
    }

    /// The agent a lane opens: its first agent (the PR's author first).
    pub fn lane_agent(&self, lane: &Lane) -> Option<&Agent> {
        lane.agents.iter().find_map(|id| self.agents.get(id))
    }

    /// Whether any of a lane's agents is working now.
    pub fn lane_working(&self, lane: &Lane) -> bool {
        lane.agents
            .iter()
            .filter_map(|id| self.agents.get(id))
            .any(|agent| agent.status == Status::Working)
    }

    /// Why a lane wants a look, if it does. A merged or closed pull
    /// request wants nothing.
    pub fn attention(&self, lane: &Lane) -> Option<Attention> {
        let pr = self.lane_pr(lane).filter(|pr| !pr.state.is_final())?;
        if pr.ci == CiState::Failed {
            Some(Attention::Failing)
        } else if pr.mergeable == Mergeable::Conflicting {
            Some(Attention::Conflicts)
        } else if pr.review == ReviewState::ChangesRequested {
            Some(Attention::ChangesRequested)
        } else {
            None
        }
    }

    /// The lanes of `graph` the page draws below the trunk, in `sort`
    /// order. Landed lanes are left out: they arc above the trunk. The
    /// filter matches branch, alias, agent name, PR number, title and state.
    pub fn sorted_lanes<'a>(
        &self,
        graph: &'a RepoGraph,
        filter: &Filter,
        sort: LaneSort,
    ) -> Vec<&'a Lane> {
        let lanes: Vec<&Lane> = graph
            .lanes
            .iter()
            .filter(|lane| lane.landed.is_none())
            .filter(|lane| filter.matches_lane(lane, self.lane_pr(lane), |id| self.name_of(id)))
            .collect();
        let mut ordered = fork_order(&lanes);
        if sort == LaneSort::Attention {
            // A stable sort keeps fork order inside each class.
            ordered.sort_by_key(|lane| self.attention(lane).map_or(3, |why| why as u8));
        }
        ordered
    }

    /// Pull requests of `graph`'s repository with no lane drawn for them:
    /// opened elsewhere, or their branch is gone. Open ones first, newest first.
    pub fn orphan_prs(&self, graph: &RepoGraph, filter: &Filter) -> Vec<&Pr> {
        let Some(remote) = &graph.remote else {
            return Vec::new();
        };
        let tied: HashSet<&PrId> = graph
            .lanes
            .iter()
            .filter_map(|lane| lane.pr.as_ref())
            .collect();
        let mut prs: Vec<&Pr> = self
            .prs
            .values()
            .filter(|pr| &pr.repo == remote && !tied.contains(&pr.id))
            .filter(|pr| filter.matches_pr(pr, |id| self.name_of(id)))
            .collect();
        prs.sort_by(|a, b| {
            a.state.is_final().cmp(&b.state.is_final()).then_with(|| {
                b.updated_at
                    .or(b.opened_at)
                    .cmp(&a.updated_at.or(a.opened_at))
            })
        });
        prs
    }

    /// Pull requests that belong to no repository the view maps, so the
    /// CHANGES page still lists them.
    pub fn unmapped_prs(&self, filter: &Filter) -> Vec<&Pr> {
        let remotes: HashSet<_> = self
            .repos
            .values()
            .filter_map(|graph| graph.remote.as_ref())
            .collect();
        self.sorted_prs(filter)
            .into_iter()
            .filter(|pr| !remotes.contains(&pr.repo))
            .collect()
    }
}

/// When a lane forked: its base commit's time, or for a stacked lane its
/// oldest own commit's (or its tip's) time.
pub fn fork_time(lane: &Lane) -> Option<Timestamp> {
    match &lane.base {
        LaneBase::Trunk { at, .. } => Some(*at),
        LaneBase::Lane { .. } => lane.commits.last().map(|commit| commit.at),
    }
}

/// Lanes in fork order: each stack is kept together (a lane right under
/// the lane it is stacked on, siblings newest fork first), and stacks are
/// ordered newest fork first, so the newest fork sits nearest the trunk and
/// no fork line crosses a lane.
pub fn fork_order<'a>(lanes: &[&'a Lane]) -> Vec<&'a Lane> {
    let names: HashSet<&str> = lanes.iter().map(|lane| lane.branch.as_str()).collect();
    let parent = |lane: &Lane| match &lane.base {
        LaneBase::Lane { branch, .. } if names.contains(branch.as_str()) => Some(branch.clone()),
        _ => None,
    };
    let newest_first = |a: &&Lane, b: &&Lane| {
        fork_time(b)
            .cmp(&fork_time(a))
            .then_with(|| a.branch.cmp(&b.branch))
    };
    let mut roots: Vec<&Lane> = lanes
        .iter()
        .copied()
        .filter(|lane| parent(lane).is_none())
        .collect();
    roots.sort_by(newest_first);
    let mut ordered = Vec::with_capacity(lanes.len());
    let mut stack: Vec<&Lane> = roots.into_iter().rev().collect();
    while let Some(lane) = stack.pop() {
        if ordered
            .iter()
            .any(|seen: &&Lane| seen.branch == lane.branch)
        {
            continue;
        }
        ordered.push(lane);
        let mut children: Vec<&Lane> = lanes
            .iter()
            .copied()
            .filter(|child| parent(child).as_deref() == Some(lane.branch.as_str()))
            .collect();
        children.sort_by(newest_first);
        stack.extend(children.into_iter().rev());
    }
    // A cycle of stacks (never from git) still lists every lane.
    for lane in lanes {
        if !ordered.iter().any(|seen| seen.branch == lane.branch) {
            ordered.push(lane);
        }
    }
    ordered
}

/// Filters owned by one list page.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Filter {
    /// List ended agents too, not only current ones.
    pub all: bool,
    /// Restrict agent rows to one kind.
    pub kind: Option<AgentKind>,
    /// Restrict agent rows to one status.
    pub status: Option<Status>,
    /// Lowercase text query.
    pub find: String,
}

impl Filter {
    /// Whether nothing filters.
    pub fn is_empty(&self) -> bool {
        self.kind.is_none() && self.status.is_none() && self.find.is_empty()
    }

    /// Cycle through agent roles and back to all roles.
    pub fn next_kind(&mut self) {
        self.kind = match self.kind {
            None => Some(AgentKind::Manager),
            Some(AgentKind::Manager) => Some(AgentKind::Builder),
            Some(AgentKind::Builder) => Some(AgentKind::Explorer),
            Some(AgentKind::Explorer) => Some(AgentKind::Planner),
            Some(AgentKind::Planner) => Some(AgentKind::Chatter),
            Some(AgentKind::Chatter) => Some(AgentKind::Reviewer),
            Some(AgentKind::Reviewer) => Some(AgentKind::Subagent),
            Some(AgentKind::Subagent) => Some(AgentKind::MacrodSession),
            Some(AgentKind::MacrodSession) => Some(AgentKind::WorkRun),
            Some(AgentKind::WorkRun) => Some(AgentKind::Factory),
            Some(AgentKind::Factory) => Some(AgentKind::Shell),
            Some(AgentKind::Shell) => Some(AgentKind::Other),
            Some(AgentKind::Other) => None,
        };
    }

    /// Cycle statuses; final statuses also include ended agents.
    pub fn next_status(&mut self) {
        self.status = match self.status {
            None => Some(Status::Working),
            Some(Status::Working) => Some(Status::Waiting),
            Some(Status::Waiting) => Some(Status::Blocked),
            Some(Status::Blocked) => Some(Status::Idle),
            Some(Status::Idle) => Some(Status::Done),
            Some(Status::Done) => Some(Status::Failed),
            Some(Status::Failed) => Some(Status::Stopped),
            Some(Status::Stopped) => None,
        };
        if self.status.is_some_and(Status::is_final) {
            self.all = true;
        }
    }

    fn find_matches(&self, agent: &Agent) -> bool {
        let find = self.find.as_str();
        agent.name.to_lowercase().contains(find)
            || agent
                .task
                .as_deref()
                .is_some_and(|task| task.to_lowercase().contains(find))
            || agent
                .program
                .as_deref()
                .is_some_and(|program| program.to_lowercase().contains(find))
            || agent
                .doing
                .as_deref()
                .is_some_and(|doing| doing.to_lowercase().contains(find))
    }

    /// Whether an agent row shows.
    pub fn matches_agent(&self, agent: &Agent) -> bool {
        self.kind.is_none_or(|kind| agent.kind == kind)
            && self.status.is_none_or(|status| agent.status == status)
            && (self.find.is_empty() || self.find_matches(agent))
    }

    /// Whether a pull request row shows; `name_of` names its agents.
    pub fn matches_pr(&self, pr: &Pr, name_of: impl Fn(&AgentId) -> String) -> bool {
        if self.is_empty() {
            return true;
        }
        let state = pr_state_word(pr.state);
        let haystack = [
            pr.title.clone().unwrap_or_default(),
            pr.repo.as_str().to_owned(),
            pr.branch.clone().unwrap_or_default(),
            format!("#{}", pr.number),
            state.to_owned(),
        ]
        .into_iter()
        .chain(pr.agents.iter().map(&name_of))
        .map(|text| text.to_lowercase())
        .collect::<Vec<_>>();
        let has = |needle: &str| haystack.iter().any(|text| text.contains(needle));
        self.find.is_empty() || has(&self.find)
    }

    /// Whether a lane shows: the text query must match its
    /// branch, an alias, an agent's name, or its pull request's number,
    /// title or state.
    pub fn matches_lane(
        &self,
        lane: &Lane,
        pr: Option<&Pr>,
        name_of: impl Fn(&AgentId) -> String,
    ) -> bool {
        if self.is_empty() {
            return true;
        }
        let mut haystack: Vec<String> = vec![lane.branch.clone()];
        haystack.extend(lane.aliases.iter().cloned());
        haystack.extend(lane.agents.iter().map(&name_of));
        if let Some(pr) = pr {
            haystack.push(format!("#{}", pr.number));
            haystack.push(pr.title.clone().unwrap_or_default());
            haystack.push(pr_state_word(pr.state).to_owned());
        }
        let haystack: Vec<String> = haystack.iter().map(|text| text.to_lowercase()).collect();
        let has = |needle: &str| haystack.iter().any(|text| text.contains(needle));
        self.find.is_empty() || has(&self.find)
    }

    /// Whether a tape line shows; `agent` is its agent's row, if known.
    pub fn matches_event(&self, event: &TapeEvent, agent: Option<&Agent>) -> bool {
        if self.is_empty() {
            return true;
        }

        self.find.is_empty()
            || event.text.to_lowercase().contains(&self.find)
            || agent.is_some_and(|agent| self.find_matches(agent))
    }
}

/// A pull request state as the PRS pane writes it.
pub fn pr_state_word(state: PrState) -> &'static str {
    match state {
        PrState::Unknown => "…",
        PrState::Open => "open",
        PrState::Draft => "draft",
        PrState::Merged => "merged",
        PrState::Closed => "closed",
    }
}
