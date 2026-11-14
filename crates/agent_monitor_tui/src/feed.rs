//! Where the viewer's updates and transcripts come from: the collector over
//! its socket, or an in-process demo fleet.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use futures::StreamExt as _;
use futures::stream::BoxStream;
use tokio::sync::broadcast::error::RecvError;
use tokio_util::sync::{CancellationToken, DropGuard};
use tokio_util::task::TaskTracker;

use agent_monitor::client::{ClientError, ClientEvent, MonitorClient, watch};
use agent_monitor::domain::clock::{Clock, SystemClock};
use agent_monitor::domain::model::{Agent, MonitorStatus};
use agent_monitor::domain::source::{TranscriptError, TranscriptFeed, TranscriptStream};
use agent_monitor::domain::store::{Store, StoreConfig};
use agent_monitor::domain::supervisor::spawn_source;
use agent_monitor::outbound::demo::{DemoConfig, DemoSource, DemoTranscripts};
use agent_monitor::proto::PROTOCOL;

/// An update stream and a transcript reader for the run loop.
pub struct Feed {
    /// Connection events and updates.
    pub updates: BoxStream<'static, ClientEvent>,
    /// Reads one agent's transcript for the drill-in page.
    pub transcripts: Arc<dyn TranscriptFeed>,
    /// Stops the feed's background work when dropped.
    _stop: DropGuard,
}

/// The collector on `socket`, reconnecting with backoff.
pub fn socket(socket: PathBuf) -> Feed {
    let cancel = CancellationToken::new();
    Feed {
        updates: watch(socket.clone(), cancel.clone()).boxed(),
        transcripts: Arc::new(SocketTranscripts { socket }),
        _stop: cancel.drop_guard(),
    }
}

/// Follows transcripts through the collector, one connection per follow.
struct SocketTranscripts {
    socket: PathBuf,
}

// `async_trait` because the run loop holds the reader as `Arc<dyn TranscriptFeed>`.
#[async_trait]
impl TranscriptFeed for SocketTranscripts {
    async fn follow(
        &self,
        agent: &Agent,
        tail: usize,
    ) -> Result<TranscriptStream, TranscriptError> {
        let tail = u32::try_from(tail).unwrap_or(u32::MAX);
        let mut client = MonitorClient::connect(&self.socket)
            .await
            .map_err(|error| {
                TranscriptError::Internal(rootcause::Report::new(error).into_dynamic())
            })?;
        let stream =
            client
                .follow_transcript(&agent.id, tail)
                .await
                .map_err(|error| match error {
                    // The collector's way of saying this agent has no transcript.
                    ClientError::Call(status)
                        if status.code() == tonic::Code::FailedPrecondition =>
                    {
                        TranscriptError::Unavailable
                    }
                    error => {
                        TranscriptError::Internal(rootcause::Report::new(error).into_dynamic())
                    }
                })?;

        // A failed item ends the stream; the page shows what it has.
        let items = stream
            .take_while(|item| std::future::ready(item.is_ok()))
            .filter_map(|item| std::future::ready(item.ok()));
        Ok(Box::pin(items))
    }
}

/// The scripted demo fleet, run through a real store in this process.
/// Must be called inside a tokio runtime.
pub fn demo(seed: u64) -> Feed {
    let cancel = CancellationToken::new();
    let tracker = TaskTracker::new();
    let clock: Arc<dyn Clock> = Arc::new(SystemClock);
    let store = Store::start(
        StoreConfig::default(),
        clock.clone(),
        &tracker,
        cancel.clone(),
    );
    let transcripts = DemoTranscripts::default();

    let config = DemoConfig {
        seed,
        ..DemoConfig::default()
    };
    let source_transcripts = transcripts.clone();
    spawn_source(
        &store,
        move || {
            Box::new(DemoSource::new(
                config,
                clock.clone(),
                source_transcripts.clone(),
            ))
        },
        &tracker,
        cancel.clone(),
    );
    tracker.close();

    let updates = async_stream::stream! {
        yield ClientEvent::Connected(MonitorStatus {
            protocol: PROTOCOL,
            version: String::from("demo"),
            uptime: std::time::Duration::ZERO,
            sources: store.sources(),
            subscribers: 1,
        });
        loop {
            let subscription = store.subscribe();
            yield ClientEvent::Update(Box::new((*subscription.snapshot).clone()));
            let mut updates = subscription.updates;
            loop {
                match updates.recv().await {
                    Ok(update) => yield ClientEvent::Update(Box::new((*update).clone())),
                    // Fell behind: start again from a fresh snapshot.
                    Err(RecvError::Lagged(_)) => break,
                    Err(RecvError::Closed) => return,
                }
            }
        }
    };

    Feed {
        updates: updates.boxed(),
        transcripts: Arc::new(transcripts),
        _stop: cancel.drop_guard(),
    }
}
