//! The ports the store's surroundings implement: sources of observations, and
//! readers of an agent's transcript.

use std::pin::Pin;

use async_trait::async_trait;
use futures::Stream;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::{Agent, TranscriptItem};
use crate::domain::observation::Observation;

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
    /// A short name for spans and health.
    fn name(&self) -> &'static str;

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
