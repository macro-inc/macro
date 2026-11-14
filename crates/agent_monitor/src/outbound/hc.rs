//! hc terminals, pushed by `hc events --json` running as a child process.
//!
//! Line 1 is a snapshot of every terminal (a [`Change::Reset`]); each later
//! line is one JSON-RPC `event` (a fact change on one terminal), a
//! `heartbeat` every 15 s, or `missed` followed by a fresh snapshot when the
//! reader lagged. The CLI is used instead of the socket because it is the
//! supported surface and finds its own socket.

mod parse;
#[cfg(test)]
mod test;

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use rootcause::{Report, report};
use tokio::io::{AsyncBufReadExt as _, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::{SourceHealth, SourceKind, SourceState};
use crate::domain::observation::{Change, Observation};
use crate::domain::source::{AgentSource, SourceError};
pub use parse::HcLabels;
use parse::{Line, Terminals};

/// hc sends a heartbeat every 15 s; three missed ones mean the feed is stuck.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);

/// Reads every hc terminal from `hc events --json`.
#[derive(Clone, Debug)]
pub struct HcSource {
    program: PathBuf,
    labels: HcLabels,
}

impl HcSource {
    /// A source that runs `program` (normally `hc`, found on `PATH`) and
    /// decodes the given extra labels.
    pub fn new(program: PathBuf, labels: HcLabels) -> Self {
        Self { program, labels }
    }
}

#[async_trait]
impl AgentSource for HcSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Hc
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        self.follow(out, cancel).await
    }
}

/// Why the feed has to start over.
#[derive(Debug, thiserror::Error)]
enum FeedError {
    #[error("hc events exited")]
    Exited,
    #[error("no heartbeat from hc events for {0:?}")]
    Silent(Duration),
    #[error("hc events sent an event for an unknown terminal")]
    UnknownTerminal,
    #[error("hc events did not send a snapshot after reporting missed events")]
    NoSnapshotAfterMissed,
}

impl HcSource {
    async fn follow(
        self,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        let spawned = Command::new(&self.program)
            .args(["events", "--json"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // No hc on this machine: report it once and stay quiet.
                send(&out, health(SourceState::Absent, 0, Some("hc not found"))).await?;
                cancel.cancelled().await;
                return Ok(());
            }
            Err(error) => return Err(report!(error).into_dynamic().into()),
        };
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Report::from(report!("hc events has no stdout")))?;
        let mut lines = BufReader::new(stdout).lines();

        let mut terminals = Terminals::default();
        let mut snapshot_due = true;
        loop {
            let line = tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                line = tokio::time::timeout(HEARTBEAT_TIMEOUT, lines.next_line()) => line,
            };
            let line = match line {
                Err(_elapsed) => return Err(feed_error(FeedError::Silent(HEARTBEAT_TIMEOUT))),
                Ok(Err(error)) => return Err(report!(error).into_dynamic().into()),
                Ok(Ok(None)) => return Err(feed_error(FeedError::Exited)),
                Ok(Ok(Some(line))) => line,
            };

            match parse::line(&line) {
                Line::Snapshot(snapshot) => {
                    snapshot_due = false;
                    terminals = Terminals::from_snapshot(snapshot);
                    let facts = terminals.facts(&self.labels);
                    let count = u32::try_from(facts.len()).unwrap_or(u32::MAX);
                    tracing::info_span!(
                        "macrod.monitor.source.batch",
                        source = SourceKind::Hc.name(),
                        observations = count,
                        bytes = line.len(),
                    )
                    .in_scope(|| tracing::debug!("hc snapshot"));
                    send(&out, Change::Reset(facts)).await?;
                    send(&out, health(SourceState::Healthy, count, None)).await?;
                }
                Line::Missed => snapshot_due = true,
                _ if snapshot_due => return Err(feed_error(FeedError::NoSnapshotAfterMissed)),
                Line::Event(event) => match terminals.apply(event, &self.labels) {
                    Ok(Some(change)) => send(&out, change).await?,
                    Ok(None) => {}
                    Err(parse::UnknownTerminal) => {
                        return Err(feed_error(FeedError::UnknownTerminal));
                    }
                },
                Line::Heartbeat | Line::Other => {}
            }
        }
    }
}

fn feed_error(error: FeedError) -> SourceError {
    SourceError::Internal(report!(error).into_dynamic())
}

fn health(state: SourceState, items: u32, detail: Option<&str>) -> Change {
    let mut health = SourceHealth::starting(SourceKind::Hc);
    health.state = state;
    health.items = items;
    health.detail = detail.map(str::to_owned);
    health.last_event = Some(Utc::now());
    Change::Health(health)
}

async fn send(out: &mpsc::Sender<Observation>, change: Change) -> Result<(), SourceError> {
    out.send(Observation {
        source: SourceKind::Hc,
        change,
    })
    .await
    .map_err(|_closed| SourceError::StoreClosed)
}
