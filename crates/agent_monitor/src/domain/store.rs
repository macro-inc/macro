//! The single-writer store. Sources send observations into one bounded mpsc;
//! one reducer task applies them to [`Facts`], rebuilds agents, diffs them
//! against the rows it published, and publishes sequenced updates on a
//! broadcast channel. Board totals also go out on a `watch` channel.
//!
//! A subscriber copies the snapshot and subscribes to the broadcast under the
//! same lock the reducer publishes under, so it never misses an update between
//! the two.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use chrono::{FixedOffset, Local, Offset as _, TimeDelta, Timelike};
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time::{Instant, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::domain::clock::Clock;
use crate::domain::source::PrInterest;
use crate::domain::join::{
    FactEvent, Facts, MinuteCounts, build_agents, minute_counts, spend_since,
};
use crate::domain::model::{
    ACTIVITY_MINUTES, Agent, AgentId, AgentKind, CiState, Cost, Pr, PrId, PrState, Severity,
    Snapshot, SourceHealth, SourceKind, Status, TapeEvent, TapeKind, Timestamp, Totals, Update,
    UpdateKind,
};
use crate::domain::observation::{
    Change, FactKey, Observation, PrWanted, TranscriptEventKind, TranscriptKey,
};

/// Store sizes and timings.
#[derive(Clone, Debug)]
pub struct StoreConfig {
    /// Observations buffered between sources and the reducer.
    pub observation_capacity: usize,
    /// Updates buffered per subscriber before it lags and is re-snapshotted.
    pub update_capacity: usize,
    /// Tape lines kept.
    pub tape_capacity: usize,
    /// Tape lines a new subscriber receives.
    pub snapshot_tape: usize,
    /// How long the reducer gathers a burst before publishing it, so a busy
    /// agent yields one upsert per window.
    pub coalesce: Duration,
    /// How often time-driven state (activity minutes, recency, totals,
    /// source health) is recomputed.
    pub tick: Duration,
    /// How often the store publishes a heartbeat, so viewers can tell a
    /// quiet collector from a stalled one.
    pub heartbeat: Duration,
    /// Transcript records older than this do not become tape lines, so a
    /// startup index does not flood the tape.
    pub tape_recent: TimeDelta,
    /// The UTC offset whose midnight starts "today" for spend; `None` uses the
    /// machine's local time zone. Fixed in tests so totals do not depend on
    /// where they run.
    pub day_offset: Option<FixedOffset>,
    /// How long an ended agent's facts are kept (`[monitor] history_hours`):
    /// older ones that nothing live holds are dropped on the tick.
    pub history: TimeDelta,
}

impl Default for StoreConfig {
    fn default() -> Self {
        Self {
            observation_capacity: 4096,
            update_capacity: 4096,
            tape_capacity: 5000,
            snapshot_tape: 500,
            coalesce: Duration::from_millis(50),
            tick: Duration::from_secs(1),
            heartbeat: Duration::from_secs(15),
            tape_recent: TimeDelta::minutes(5),
            day_offset: None,
            history: TimeDelta::hours(24),
        }
    }
}

/// What a new subscriber starts from.
#[derive(Debug)]
pub struct Subscription {
    /// The current state as a [`UpdateKind::Snapshot`]; its `seq` is the last
    /// update it includes.
    pub snapshot: Arc<Update>,
    /// Every update after the snapshot, in order.
    pub updates: broadcast::Receiver<Arc<Update>>,
}

/// The published state.
#[derive(Debug, Default)]
struct State {
    seq: u64,
    agents: BTreeMap<AgentId, Agent>,
    tape: VecDeque<TapeEvent>,
    totals: Totals,
    sources: BTreeMap<SourceKind, SourceHealth>,
    prs: BTreeMap<PrId, Pr>,
}

#[derive(Debug)]
struct Shared {
    config: StoreConfig,
    state: Mutex<State>,
    updates: broadcast::Sender<Arc<Update>>,
    totals: watch::Sender<Arc<Totals>>,
    wanted: watch::Sender<Arc<PrWanted>>,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Applies each change to the published state and broadcasts it, under
    /// one lock so subscribers see a gapless sequence.
    fn publish(&self, kinds: Vec<UpdateKind>) {
        if kinds.is_empty() {
            return;
        }

        let mut state = self.lock();
        for kind in kinds {
            state.seq += 1;
            let seq = state.seq;
            let kind = match kind {
                UpdateKind::Event(mut event) => {
                    event.seq = seq;
                    if state.tape.len() == self.config.tape_capacity {
                        state.tape.pop_front();
                    }
                    state.tape.push_back(event.clone());
                    UpdateKind::Event(event)
                }
                kind => {
                    apply_to_state(&mut state, &kind);
                    kind
                }
            };
            // No receivers is fine: nobody is watching yet.
            let _ = self.updates.send(Arc::new(Update { seq, kind }));
        }
    }

    fn snapshot(&self, state: &State) -> Arc<Update> {
        let skip = state.tape.len().saturating_sub(self.config.snapshot_tape);
        Arc::new(Update {
            seq: state.seq,
            kind: UpdateKind::Snapshot(Snapshot {
                agents: state.agents.values().cloned().collect(),
                tape: state.tape.iter().skip(skip).cloned().collect(),
                totals: state.totals.clone(),
                sources: state.sources.values().cloned().collect(),
                prs: state.prs.values().cloned().collect(),
            }),
        })
    }
}

fn apply_to_state(state: &mut State, kind: &UpdateKind) {
    match kind {
        UpdateKind::Upsert(agent) => {
            state.agents.insert(agent.id.clone(), agent.clone());
        }
        UpdateKind::Removed(id) => {
            state.agents.remove(id);
        }
        UpdateKind::Totals(totals) => state.totals = totals.clone(),
        UpdateKind::Source(health) => {
            state.sources.insert(health.source, health.clone());
        }
        UpdateKind::PrUpsert(pr) => {
            state.prs.insert(pr.id.clone(), pr.clone());
        }
        UpdateKind::PrRemoved(id) => {
            state.prs.remove(id);
        }
        UpdateKind::Snapshot(_) | UpdateKind::Event(_) | UpdateKind::Heartbeat(_) => {}
    }
}

/// A handle to the store: cheap to clone, shared by sources and the server.
#[derive(Clone, Debug)]
pub struct Store {
    shared: Arc<Shared>,
    observations: mpsc::Sender<Observation>,
}

/// Runs observations through the store's reducer synchronously at a fixed
/// clock and returns the state it would publish. Each step is a time and the
/// observations that arrived by then; the reducer rebuilds agents once per
/// step and recomputes totals and source health after it, as a live store
/// does once per coalescing window and tick. For tests and recordings that
/// need a fixed state.
pub fn replay(
    config: StoreConfig,
    steps: impl IntoIterator<Item = (Timestamp, Vec<Observation>)>,
) -> Snapshot {
    let (updates, _) = broadcast::channel(1);
    let (totals, _) = watch::channel(Arc::new(Totals::default()));
    let (wanted, _) = watch::channel(Arc::new(PrWanted::default()));
    let shared = Arc::new(Shared {
        config,
        state: Mutex::new(State::default()),
        updates,
        totals,
        wanted,
    });
    let clock = Arc::new(ReplayClock(Mutex::new(Timestamp::default())));
    let mut reducer = Reducer::new(shared.clone(), clock.clone());

    for (now, observations) in steps {
        *clock.0.lock().unwrap_or_else(PoisonError::into_inner) = now;
        for observation in observations {
            reducer.apply(observation);
        }
        reducer.reduce();
        reducer.publish_totals();
        reducer.publish_health();
    }

    let state = shared.lock();
    match &shared.snapshot(&state).kind {
        UpdateKind::Snapshot(snapshot) => snapshot.clone(),
        _ => Snapshot::default(),
    }
}

/// The clock a replay sets before each step.
struct ReplayClock(Mutex<Timestamp>);

impl Clock for ReplayClock {
    fn now(&self) -> Timestamp {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Store {
    /// Starts the reducer on `tracker`; it runs until `cancel` fires or every
    /// observation sender is dropped.
    pub fn start(
        config: StoreConfig,
        clock: Arc<dyn Clock>,
        tracker: &TaskTracker,
        cancel: CancellationToken,
    ) -> Self {
        let (observations, receiver) = mpsc::channel(config.observation_capacity);
        let (updates, _) = broadcast::channel(config.update_capacity);
        let (totals, _) = watch::channel(Arc::new(Totals::default()));
        let (wanted, _) = watch::channel(Arc::new(PrWanted::default()));
        let shared = Arc::new(Shared {
            config,
            state: Mutex::new(State::default()),
            updates,
            totals,
            wanted,
        });

        let reducer = Reducer::new(shared.clone(), clock);
        tracker.spawn(reducer.run(receiver, cancel));
        Self {
            shared,
            observations,
        }
    }

    /// Where sources send observations.
    pub fn observations(&self) -> mpsc::Sender<Observation> {
        self.observations.clone()
    }

    /// The current snapshot and every update after it.
    pub fn subscribe(&self) -> Subscription {
        let state = self.shared.lock();
        Subscription {
            snapshot: self.shared.snapshot(&state),
            updates: self.shared.updates.subscribe(),
        }
    }

    /// The board numbers, recomputed at most once a tick.
    pub fn totals(&self) -> watch::Receiver<Arc<Totals>> {
        self.shared.totals.subscribe()
    }

    /// One agent's current row.
    pub fn agent(&self, id: &AgentId) -> Option<Agent> {
        self.shared.lock().agents.get(id).cloned()
    }

    /// Every source's health.
    pub fn sources(&self) -> Vec<SourceHealth> {
        self.shared.lock().sources.values().cloned().collect()
    }

    /// How many subscribers are attached.
    pub fn subscribers(&self) -> usize {
        self.shared.updates.receiver_count()
    }

    /// What the GitHub source should look up, republished whenever it changes.
    pub fn pr_wanted(&self) -> watch::Receiver<Arc<PrWanted>> {
        self.shared.wanted.subscribe()
    }

    /// What the GitHub source needs from the store.
    pub fn pr_interest(&self) -> PrInterest {
        let updates = self.shared.updates.clone();
        PrInterest {
            wanted: self.pr_wanted(),
            subscribers: Arc::new(move || updates.receiver_count()),
        }
    }

    /// One pull request's current row.
    pub fn pr(&self, id: &PrId) -> Option<Pr> {
        self.shared.lock().prs.get(id).cloned()
    }
}

/// The single writer.
struct Reducer {
    shared: Arc<Shared>,
    clock: Arc<dyn Clock>,
    facts: Facts,
    /// The rows last published.
    published: BTreeMap<AgentId, Agent>,
    /// The pull requests last published.
    published_prs: BTreeMap<PrId, Pr>,
    /// Transcript records not yet turned into tape lines.
    pending_events: Vec<FactEvent>,
    /// Source health as reported, merged with when each last sent anything.
    health: BTreeMap<SourceKind, SourceHealth>,
    last_event: BTreeMap<SourceKind, Timestamp>,
    published_health: BTreeMap<SourceKind, SourceHealth>,
    /// Recent open tool calls' names by transcript and call id, so a failure
    /// line can name its tool.
    tool_names: HashMap<(FactKey, String), String>,
    /// The agent each fact merged into, as last built.
    owners: BTreeMap<FactKey, AgentId>,
}

impl Reducer {
    fn new(shared: Arc<Shared>, clock: Arc<dyn Clock>) -> Self {
        Self {
            shared,
            clock,
            facts: Facts::default(),
            published: BTreeMap::new(),
            published_prs: BTreeMap::new(),
            pending_events: Vec::new(),
            health: BTreeMap::new(),
            last_event: BTreeMap::new(),
            published_health: BTreeMap::new(),
            tool_names: HashMap::new(),
            owners: BTreeMap::new(),
        }
    }

    async fn run(mut self, mut receiver: mpsc::Receiver<Observation>, cancel: CancellationToken) {
        let config = self.shared.config.clone();
        let mut tick = tokio::time::interval(config.tick);
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut heartbeat =
            tokio::time::interval_at(Instant::now() + config.heartbeat, config.heartbeat);
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                () = cancel.cancelled() => break,
                observation = receiver.recv() => {
                    let Some(observation) = observation else { break };
                    let open = self.gather(observation, &mut receiver, config.coalesce).await;
                    self.reduce();
                    if !open {
                        break;
                    }
                }
                _ = tick.tick() => {
                    self.prune();
                    self.reduce();
                    self.publish_totals();
                    self.publish_health();
                }
                _ = heartbeat.tick() => {
                    let now = self.clock.now();
                    self.shared.publish(vec![UpdateKind::Heartbeat(now)]);
                }
            }
        }
    }

    /// Applies `first` and everything else that arrives within the coalescing
    /// window. Returns false once every sender is gone.
    async fn gather(
        &mut self,
        first: Observation,
        receiver: &mut mpsc::Receiver<Observation>,
        window: Duration,
    ) -> bool {
        self.apply(first);
        let deadline = tokio::time::sleep(window);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                biased;
                () = &mut deadline => return true,
                observation = receiver.recv() => match observation {
                    Some(observation) => self.apply(observation),
                    None => return false,
                },
            }
        }
    }

    fn apply(&mut self, observation: Observation) {
        let now = self.clock.now();
        self.last_event.insert(observation.source, now);

        if let Change::Health(health) = &observation.change {
            let restarts = self
                .health
                .get(&health.source)
                .map_or(0, |previous| previous.restarts);
            let mut health = health.clone();
            health.restarts = health.restarts.max(restarts);
            self.health.insert(health.source, health);
            self.publish_health();
            return;
        }

        let is_reset = matches!(observation.change, Change::Reset(_));
        if let Change::Remove(key) = &observation.change {
            self.tool_names.retain(|(owner, _), _| owner != key);
        }
        if is_reset {
            self.tool_names.clear();
        }

        let events = self.facts.apply(observation, now);
        // A reset re-sends what a source already reported (a restart re-reads
        // its files), so its records are counted but not written to the tape again.
        if !is_reset {
            self.pending_events.extend(events);
        }
    }

    /// Rebuilds every agent, diffs against the published rows, and publishes
    /// the changed rows and the tape lines they imply.
    fn reduce(&mut self) {
        let span = tracing::debug_span!(
            "macrod.monitor.store.reduce",
            agents = tracing::field::Empty,
            upserts = tracing::field::Empty,
            removed = tracing::field::Empty,
            tape = tracing::field::Empty,
            prs = tracing::field::Empty,
        );
        let _entered = span.enter();
        let now = self.clock.now();
        let built = build_agents(&self.facts, now);
        let recent = now - self.shared.config.tape_recent;
        let mut updates = Vec::new();
        let mut tape = Vec::new();

        for (id, agent) in &built.agents {
            match self.published.get(id) {
                Some(previous) if previous == agent => {}
                Some(previous) => {
                    if previous.status != agent.status {
                        tape.push(status_line(agent, now));
                    }
                    updates.push(UpdateKind::Upsert(agent.clone()));
                }
                None => {
                    if agent.started.is_some_and(|started| started >= recent) {
                        tape.push(line(
                            now,
                            id,
                            TapeKind::Spawned,
                            spawned_text(agent),
                            Severity::Info,
                        ));
                    }
                    updates.push(UpdateKind::Upsert(agent.clone()));
                }
            }
        }

        for id in self.published.keys() {
            if !built.agents.contains_key(id) {
                tape.push(line(
                    now,
                    id,
                    TapeKind::Removed,
                    String::from("removed"),
                    Severity::Info,
                ));
                updates.push(UpdateKind::Removed(id.clone()));
            }
        }

        for (id, pr) in &built.prs {
            match self.published_prs.get(id) {
                Some(previous) if previous == pr => {}
                previous => {
                    tape.extend(pr_lines(previous, pr, now, recent));
                    updates.push(UpdateKind::PrUpsert(pr.clone()));
                }
            }
        }
        for id in self.published_prs.keys() {
            if !built.prs.contains_key(id) {
                updates.push(UpdateKind::PrRemoved(id.clone()));
            }
        }

        for event in std::mem::take(&mut self.pending_events) {
            let tape_line = self.event_line(&built.owners, event, recent);
            tape.extend(tape_line);
        }

        let upserts = updates
            .iter()
            .filter(|update| matches!(update, UpdateKind::Upsert(_)))
            .count();
        span.record("agents", built.agents.len());
        span.record("upserts", upserts);
        span.record("removed", updates.len() - upserts);
        span.record("tape", tape.len());
        span.record("prs", built.prs.len());

        let wanted = self.facts.wanted(&built);
        if **self.shared.wanted.borrow() != wanted {
            self.shared.wanted.send_replace(Arc::new(wanted));
        }

        updates.extend(tape.into_iter().map(UpdateKind::Event));
        self.shared.publish(updates);
        self.published = built.agents;
        self.published_prs = built.prs;
        self.owners = built.owners;
    }

    fn event_line(
        &mut self,
        owners: &BTreeMap<FactKey, AgentId>,
        event: FactEvent,
        recent: Timestamp,
    ) -> Option<TapeEvent> {
        // Older records (a startup index) are counted but write no tape line.
        if event.at < recent {
            return None;
        }

        let (kind, text, severity) = match event.kind {
            TranscriptEventKind::TurnStart => (
                TapeKind::TurnStart,
                String::from("turn start"),
                Severity::Info,
            ),
            TranscriptEventKind::TurnEnd => {
                (TapeKind::TurnEnd, String::from("turn end"), Severity::Info)
            }
            TranscriptEventKind::ToolStart { id, name, gist } => {
                let text = match gist {
                    Some(gist) => format!("{name} {gist}"),
                    None => name.clone(),
                };
                self.tool_names.insert((event.key.clone(), id), name);
                (TapeKind::ToolStart, text, Severity::Info)
            }
            TranscriptEventKind::ToolEnd { id, is_error } => {
                let name = self.tool_names.remove(&(event.key.clone(), id));
                if !is_error {
                    return None;
                }
                let text = match name {
                    Some(name) => format!("{name} failed"),
                    None => String::from("tool failed"),
                };
                (TapeKind::ToolError, text, Severity::Warning)
            }
            TranscriptEventKind::Usage(_)
            | TranscriptEventKind::Cost(_)
            | TranscriptEventKind::PrOpened(_) => return None,
        };

        let agent = owners.get(&event.key)?;
        Some(line(event.at, agent, kind, text, severity))
    }

    /// Drops facts of agents that ended longer ago than the history window.
    fn prune(&mut self) {
        let dropped = self
            .facts
            .prune(self.clock.now(), self.shared.config.history);
        if dropped > 0 {
            let facts = &self.facts;
            self.tool_names.retain(|(key, _), _| facts.holds(key));
            tracing::debug!(dropped, "pruned ended agents' facts");
        }
    }

    fn publish_totals(&mut self) {
        let now = self.clock.now();
        let offset = self
            .shared
            .config
            .day_offset
            .unwrap_or_else(|| now.with_timezone(&Local).offset().fix());
        let spend = spend_by_kind(
            &spend_since(&self.facts, midnight(now, offset), now),
            &self.owners,
            &self.published,
        );
        let totals = totals(
            &self.published,
            &minute_counts(&self.facts, now),
            spend,
            now,
            offset,
        );
        if **self.shared.totals.borrow() == totals {
            return;
        }
        self.shared.totals.send_replace(Arc::new(totals.clone()));
        self.shared.publish(vec![UpdateKind::Totals(totals)]);
    }

    fn publish_health(&mut self) {
        let mut updates = Vec::new();
        for (source, health) in &self.health {
            let mut health = health.clone();
            health.last_event = self.last_event.get(source).copied();
            if self.published_health.get(source) != Some(&health) {
                self.published_health.insert(*source, health.clone());
                updates.push(UpdateKind::Source(health));
            }
        }
        self.shared.publish(updates);
    }
}

fn line(
    at: Timestamp,
    agent: &AgentId,
    kind: TapeKind,
    text: String,
    severity: Severity,
) -> TapeEvent {
    TapeEvent {
        // Assigned when published.
        seq: 0,
        at,
        agent: agent.clone(),
        kind,
        text,
        severity,
    }
}

/// The tape lines a pull request's change implies: opened (when recent), CI
/// passed or failed, merged or closed. A first lookup (from unknown) writes
/// nothing, so a startup does not flood the tape. A line goes to the
/// pull request's first agent, else to `pr:<id>`.
fn pr_lines(previous: Option<&Pr>, pr: &Pr, now: Timestamp, recent: Timestamp) -> Vec<TapeEvent> {
    let agent = pr
        .agents
        .first()
        .cloned()
        .unwrap_or_else(|| AgentId::from_wire(format!("pr:{}", pr.id)));
    let name = format!("{}#{}", pr.repo.name(), pr.number);
    let mut lines = Vec::new();
    let Some(previous) = previous else {
        if pr.opened_at.is_some_and(|opened| opened >= recent) {
            let at = pr.opened_at.unwrap_or(now);
            lines.push(line(at, &agent, TapeKind::PrOpened, format!("{name} opened"), Severity::Notice));
        }
        return lines;
    };

    if previous.ci != pr.ci && previous.ci != CiState::Unknown {
        match pr.ci {
            CiState::Failed => lines.push(line(
                now,
                &agent,
                TapeKind::PrCiFailed,
                format!("{name} CI failed"),
                Severity::Error,
            )),
            CiState::Passed => lines.push(line(
                now,
                &agent,
                TapeKind::PrCiPassed,
                format!("{name} CI passed"),
                Severity::Notice,
            )),
            CiState::Unknown | CiState::None | CiState::Running => {}
        }
    }
    if previous.state != pr.state && previous.state != PrState::Unknown {
        let at = pr.closed_at.unwrap_or(now);
        match pr.state {
            PrState::Merged => lines.push(line(
                at,
                &agent,
                TapeKind::PrMerged,
                format!("{name} merged"),
                Severity::Notice,
            )),
            PrState::Closed => lines.push(line(
                at,
                &agent,
                TapeKind::PrClosed,
                format!("{name} closed"),
                Severity::Info,
            )),
            PrState::Unknown | PrState::Open | PrState::Draft => {}
        }
    }
    lines
}

fn spawned_text(agent: &Agent) -> String {
    format!("{} {}", agent.kind.label(), agent.name)
}

fn status_line(agent: &Agent, now: Timestamp) -> TapeEvent {
    let detail = agent
        .status_detail
        .as_deref()
        .map(|detail| format!(" ({detail})"))
        .unwrap_or_default();
    let (kind, severity) = match agent.status {
        Status::Done => (TapeKind::Finished, Severity::Notice),
        Status::Stopped => (TapeKind::Finished, Severity::Warning),
        Status::Failed => (TapeKind::Failure, Severity::Error),
        Status::Blocked => (TapeKind::Status, Severity::Warning),
        Status::Waiting => (TapeKind::Status, Severity::Notice),
        Status::Working | Status::Idle => (TapeKind::Status, Severity::Info),
    };
    let text = format!("{}{detail}", status_word(agent.status));
    line(agent.ended.unwrap_or(now), &agent.id, kind, text, severity)
}

fn status_word(status: Status) -> &'static str {
    match status {
        Status::Working => "working",
        Status::Waiting => "waiting",
        Status::Blocked => "blocked",
        Status::Idle => "idle",
        Status::Done => "done",
        Status::Failed => "failed",
        Status::Stopped => "stopped",
    }
}

/// The start of the local day that holds `now`.
fn midnight(now: Timestamp, offset: FixedOffset) -> Timestamp {
    now.with_timezone(&offset)
        .with_hour(0)
        .and_then(|at| at.with_minute(0))
        .and_then(|at| at.with_second(0))
        .and_then(|at| at.with_nanosecond(0))
        .map_or(now, |at| at.to_utc())
}

/// Each transcript's spend today, summed by the kind of agent it merged
/// into, largest first. A transcript no agent holds counts as `Other`, so the
/// kinds always add up to the day's total.
fn spend_by_kind(
    spend: &BTreeMap<TranscriptKey, f64>,
    owners: &BTreeMap<FactKey, AgentId>,
    agents: &BTreeMap<AgentId, Agent>,
) -> Vec<(AgentKind, f64)> {
    let mut by_kind: HashMap<AgentKind, f64> = HashMap::new();
    for (key, usd) in spend {
        let kind = owners
            .get(&FactKey::Transcript(key.clone()))
            .and_then(|id| agents.get(id))
            .map_or(AgentKind::Other, |agent| agent.kind);
        *by_kind.entry(kind).or_default() += usd;
    }
    let mut by_kind: Vec<(AgentKind, f64)> = by_kind.into_iter().collect();
    by_kind.sort_by(|a, b| b.1.total_cmp(&a.1));
    by_kind
}

/// The board numbers from the published rows and the per-minute counts.
fn totals(
    agents: &BTreeMap<AgentId, Agent>,
    minutes: &BTreeMap<Timestamp, MinuteCounts>,
    spend_by_kind: Vec<(AgentKind, f64)>,
    now: Timestamp,
    offset: FixedOffset,
) -> Totals {
    let mut totals = Totals {
        spend_by_kind,
        ..Totals::default()
    };
    let day_ago = now - TimeDelta::hours(24);

    for agent in agents.values() {
        match agent.status {
            Status::Working => totals.working += 1,
            Status::Waiting => totals.waiting += 1,
            Status::Blocked => totals.blocked += 1,
            Status::Failed if agent.ended.is_none_or(|ended| ended >= day_ago) => {
                totals.failed_24h += 1;
            }
            _ => {}
        }
    }

    let midnight = midnight(now, offset);
    let current_minute = now.timestamp().div_euclid(60);
    let mut spend_today = 0.0;

    for (minute, counts) in minutes {
        totals.turns_24h += counts.turns;
        totals.tools_24h += counts.tools;
        totals.errors_24h += counts.errors;

        let minutes_ago = current_minute - minute.timestamp().div_euclid(60);
        if let Ok(minutes_ago) = usize::try_from(minutes_ago)
            && minutes_ago < ACTIVITY_MINUTES
        {
            let slot = &mut totals.tokens_per_min[ACTIVITY_MINUTES - 1 - minutes_ago];
            *slot = slot.saturating_add(u32::try_from(counts.tokens).unwrap_or(u32::MAX));
        }

        if *minute >= midnight {
            let hour = minute.with_timezone(&offset).hour();
            if let Some(slot) = usize::try_from(hour)
                .ok()
                .and_then(|hour| totals.cost_by_hour.get_mut(hour))
            {
                *slot += counts.cost_usd as f32;
            }
            spend_today += counts.cost_usd;
        }
    }

    // Spend is summed from reported totals that may be estimates, so the day's
    // figure is an estimate; with no spend reported at all it is unknown, not $0.
    totals.cost_today = if spend_today > 0.0 {
        Cost::Estimated(spend_today)
    } else {
        Cost::Unpriced
    };
    totals
}
