//! The `daemon` source: what the macrod hosting the collector knows about
//! itself (its harness, runtime connection and open prompts), reported as
//! that source's health so the viewer's header can show it.

use async_trait::async_trait;
use chrono::Utc;
use harness_id::HarnessId;
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;
use tokio_util::task::AbortOnDropHandle;
use tracing::Instrument as _;

use agent_monitor::domain::model::{SourceHealth, SourceKind, SourceState, Timestamp};
use agent_monitor::domain::observation::{Change, Observation};
use agent_monitor::domain::source::{AgentSource, SourceError};

/// What the serving core reports.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DaemonState {
    /// The harness being served; `None` while nothing is served (unpaired,
    /// stopped, restarting).
    pub harness: Option<HarnessId>,
    /// Whether the runtime connection is up.
    pub connected: bool,
    /// `session/prompt` requests the agent has not answered yet.
    pub open_prompts: usize,
}

/// Where a serving core reports its state; outlives serving-core restarts.
#[derive(Clone, Debug)]
pub struct DaemonLink(watch::Sender<DaemonState>);

impl DaemonLink {
    /// A link reporting that nothing is served.
    pub fn new() -> Self {
        Self(watch::Sender::new(DaemonState::default()))
    }

    /// A receiver of the reported state.
    pub fn subscribe(&self) -> watch::Receiver<DaemonState> {
        self.0.subscribe()
    }
}

/// Copies a serving core's state into `link` until the returned handle is
/// dropped (the serving core stops), and then reports that nothing is served.
pub fn report_daemon(
    link: DaemonLink,
    harness: HarnessId,
    mut connected: watch::Receiver<bool>,
    mut open_prompts: watch::Receiver<usize>,
) -> AbortOnDropHandle<()> {
    AbortOnDropHandle::new(tokio::spawn(async move {
        // Dropped with the task, aborted or not: nothing is served any more.
        let _reset = ResetOnDrop(link.clone());
        loop {
            link.0.send_replace(DaemonState {
                harness: Some(harness),
                connected: *connected.borrow_and_update(),
                open_prompts: *open_prompts.borrow_and_update(),
            });
            let changed = tokio::select! {
                changed = connected.changed() => changed,
                changed = open_prompts.changed() => changed,
            };
            if changed.is_err() {
                return;
            }
        }
    }))
}

struct ResetOnDrop(DaemonLink);

impl Drop for ResetOnDrop {
    fn drop(&mut self) {
        self.0.0.send_replace(DaemonState::default());
    }
}

/// The source: one health report per state change.
pub(super) struct DaemonSource {
    state: watch::Receiver<DaemonState>,
}

impl DaemonSource {
    pub(super) fn new(state: watch::Receiver<DaemonState>) -> Self {
        Self { state }
    }
}

#[async_trait]
impl AgentSource for DaemonSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Daemon
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        let mut state = self.state;
        send(&out, Change::Reset(Vec::new())).await?;
        loop {
            let current = state.borrow_and_update().clone();
            let span = tracing::info_span!(
                "macrod.monitor.source.batch",
                source = SourceKind::Daemon.name()
            );
            send(&out, Change::Health(health(&current, Utc::now())))
                .instrument(span)
                .await?;
            tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                changed = state.changed() => if changed.is_err() {
                    return Ok(());
                },
            }
        }
    }
}

async fn send(out: &mpsc::Sender<Observation>, change: Change) -> Result<(), SourceError> {
    out.send(Observation {
        source: SourceKind::Daemon,
        change,
    })
    .await
    .map_err(|_| SourceError::StoreClosed)
}

/// The health row for `state`, in the shape the viewer's header reads: the
/// state says whether a harness is served (absent) and its runtime is
/// connected (healthy) or not (unhealthy), the detail is the harness id, and
/// the items are the open prompts.
pub(super) fn health(state: &DaemonState, now: Timestamp) -> SourceHealth {
    let source_state = match state.harness {
        None => SourceState::Absent,
        Some(_) if state.connected => SourceState::Healthy,
        Some(_) => SourceState::Unhealthy,
    };
    SourceHealth {
        state: source_state,
        detail: state.harness.map(|harness| harness.to_string()),
        items: u32::try_from(state.open_prompts).unwrap_or(u32::MAX),
        last_event: Some(now),
        ..SourceHealth::starting(SourceKind::Daemon)
    }
}
