//! What this process holds per session, reported every minute as OTel gauges.
//!
//! The harness keeps state for every session it touches: a command worker,
//! a loaded queue, a live `agent_session` actor and, for in-process sessions,
//! the conversation and agent task. Plotted against the task's memory, these
//! say which of them grows with it. Every gauge is one number per process,
//! with no per-session attribute.

use opentelemetry::metrics::Gauge;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

const INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

/// One sample of what the process holds.
pub(crate) struct RuntimeReadings {
    /// Sessions with a harness command worker.
    pub(crate) command_workers: usize,
    /// Sessions whose durable queue is loaded.
    pub(crate) hydrated_sessions: usize,
    /// Live `agent_session` actors, every runtime's: they all run on the
    /// harness's session service.
    pub(crate) session_actors: usize,
    /// In-process conversations held in memory.
    pub(crate) inmem_conversations: usize,
    /// In-process agent tasks running.
    pub(crate) inmem_live_agents: usize,
}

struct RuntimeGauges {
    command_workers: Gauge<u64>,
    hydrated_sessions: Gauge<u64>,
    active_sessions: Gauge<u64>,
    inmem_conversations: Gauge<u64>,
    inmem_live_agents: Gauge<u64>,
    alive_tasks: Gauge<u64>,
}

impl RuntimeGauges {
    fn new() -> Self {
        let meter = opentelemetry::global::meter("agent_harness_service");
        Self {
            command_workers: meter
                .u64_gauge("ahs.harness.workers")
                .with_description("Sessions with a harness command worker")
                .build(),
            hydrated_sessions: meter
                .u64_gauge("ahs.harness.hydrated")
                .with_description("Sessions whose durable queue is loaded")
                .build(),
            active_sessions: meter
                .u64_gauge("ahs.agent_session.active")
                .with_description("Live agent_session actors, of every runtime")
                .build(),
            inmem_conversations: meter
                .u64_gauge("ahs.inmem.store_sessions")
                .with_description("In-process conversations held in memory")
                .build(),
            inmem_live_agents: meter
                .u64_gauge("ahs.inmem.live_agents")
                .with_description("In-process agent tasks running")
                .build(),
            alive_tasks: meter
                .u64_gauge("ahs.tokio.alive_tasks")
                .with_description("Tokio tasks alive on the runtime")
                .build(),
        }
    }

    fn record(&self, readings: &RuntimeReadings, alive_tasks: usize) {
        self.command_workers
            .record(count(readings.command_workers), &[]);
        self.hydrated_sessions
            .record(count(readings.hydrated_sessions), &[]);
        self.active_sessions
            .record(count(readings.session_actors), &[]);
        self.inmem_conversations
            .record(count(readings.inmem_conversations), &[]);
        self.inmem_live_agents
            .record(count(readings.inmem_live_agents), &[]);
        self.alive_tasks.record(count(alive_tasks), &[]);
    }
}

fn count(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

/// Record `read`'s sample every minute until `cancel` fires.
pub(crate) fn spawn(
    tasks: &TaskTracker,
    cancel: CancellationToken,
    read: impl Fn() -> RuntimeReadings + Send + 'static,
) {
    let runtime = tokio::runtime::Handle::current();
    tasks.spawn(async move {
        let gauges = RuntimeGauges::new();
        let mut ticker = tokio::time::interval(INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                () = cancel.cancelled() => break,
                _ = ticker.tick() => {
                    gauges.record(&read(), runtime.metrics().num_alive_tasks());
                }
            }
        }
    });
}
