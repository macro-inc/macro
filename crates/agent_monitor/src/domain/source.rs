//! The ports the store's surroundings implement: sources of observations, and
//! readers of an agent's transcript.

use std::pin::Pin;
use std::sync::Arc;

use async_trait::async_trait;
use futures::Stream;
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

use crate::domain::model::{Agent, SourceKind, TranscriptItem};
use crate::domain::observation::{Observation, PrWanted};

/// Why a source stopped.
#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    /// The store stopped accepting observations; the collector is shutting down.
    #[error("the store is closed")]
    StoreClosed,
    /// Anything else; the supervisor restarts the source with backoff.
    #[error("source failed: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for SourceError {
    fn from(report: rootcause::Report) -> Self {
        SourceError::Internal(report)
    }
}

/// A source of observations: hc terminals, Claude transcripts, the demo fleet.
///
/// `async_trait` because the supervisor holds sources as `Box<dyn AgentSource>`.
#[async_trait]
pub trait AgentSource: Send + 'static {
    /// Which source this is; its facts and health are filed under it.
    fn kind(&self) -> SourceKind;

    /// Runs until cancelled. Sends a full [`Change::Reset`] first, then
    /// changes. Returning an error marks the source unhealthy; the supervisor
    /// restarts it with backoff.
    ///
    /// [`Change::Reset`]: crate::domain::observation::Change::Reset
    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError>;
}

/// A stream of transcript items: the tail first, then every new item.
pub type TranscriptStream = Pin<Box<dyn Stream<Item = TranscriptItem> + Send>>;

/// Why a transcript cannot be followed.
#[derive(Debug, thiserror::Error)]
pub enum TranscriptError {
    /// No reader knows this agent's transcript.
    #[error("this agent has no readable transcript")]
    Unavailable,
    /// Anything else.
    #[error("transcript read failed: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for TranscriptError {
    fn from(report: rootcause::Report) -> Self {
        TranscriptError::Internal(report)
    }
}

/// Reads one agent's transcript for the drill-in page.
///
/// `async_trait` because the server holds the reader as `Arc<dyn TranscriptFeed>`.
#[async_trait]
pub trait TranscriptFeed: Send + Sync + 'static {
    /// The last `tail` items of the agent's transcript, then every new item
    /// until the stream is dropped.
    async fn follow(&self, agent: &Agent, tail: usize)
    -> Result<TranscriptStream, TranscriptError>;
}

/// What a pull request source needs from the store: what to look up, and
/// whether anyone is watching (it asks less often when nobody is).
#[derive(Clone)]
pub struct PrInterest {
    /// What to look up, republished after each reduce that changes it.
    pub wanted: watch::Receiver<Arc<PrWanted>>,
    /// How many viewers are subscribed now.
    pub subscribers: Arc<dyn Fn() -> usize + Send + Sync>,
    /// Counts subscriptions as they arrive, so a source that waits longer
    /// while nobody watches wakes when someone starts to.
    pub arrivals: watch::Receiver<u64>,
}

impl std::fmt::Debug for PrInterest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PrInterest")
            .field("wanted", &self.wanted)
            .finish_non_exhaustive()
    }
}
