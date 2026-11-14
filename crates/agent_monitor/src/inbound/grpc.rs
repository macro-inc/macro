//! The gRPC server over a user-only Unix socket.

use std::io;
use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use futures::{Stream, StreamExt as _};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc};
use tokio_stream::wrappers::{ReceiverStream, UnixListenerStream};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use crate::domain::model::{AgentId, MonitorStatus};
use crate::domain::source::{TranscriptError, TranscriptFeed};
use crate::domain::store::Store;
use crate::proto::{PROTOCOL, wire};
use crate::trace_context;

/// Items sent ahead of a slow viewer before the stream task waits for it.
const STREAM_BUFFER: usize = 64;

/// Transcript items sent before following, when the request asks for none.
const DEFAULT_TAIL: usize = 200;

/// Why the socket could not be bound.
#[derive(Debug, thiserror::Error)]
pub enum BindError {
    /// Another collector already answers on the socket.
    #[error("another collector already serves {0}")]
    AlreadyServed(PathBuf),
    /// The socket or its directory could not be created.
    #[error("cannot bind the monitor socket: {0}")]
    Io(#[from] io::Error),
}

/// Why the server stopped.
#[derive(Debug, thiserror::Error)]
pub enum ServeError {
    /// The transport failed.
    #[error("monitor server failed: {0}")]
    Transport(#[from] tonic::transport::Error),
}

/// Binds the monitor socket: its directory is created user-only (0700) when
/// missing and the socket is user-only (0600). A socket file nobody answers on
/// is stale and replaced; a live one means another collector serves the
/// machine.
pub async fn bind(path: &Path) -> Result<UnixListener, BindError> {
    if let Some(directory) = path.parent()
        && !directory.as_os_str().is_empty()
    {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(directory)?;
    }

    if path.exists() {
        if UnixStream::connect(path).await.is_ok() {
            return Err(BindError::AlreadyServed(path.to_owned()));
        }
        std::fs::remove_file(path)?;
    }

    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Serves the monitor on `listener` until `cancel` fires.
pub async fn serve(
    listener: UnixListener,
    service: MonitorService,
    cancel: CancellationToken,
) -> Result<(), ServeError> {
    tonic::transport::Server::builder()
        .add_service(wire::agent_monitor_server::AgentMonitorServer::new(service))
        .serve_with_incoming_shutdown(UnixListenerStream::new(listener), cancel.cancelled_owned())
        .await?;
    Ok(())
}

/// The `AgentMonitor` service.
#[derive(Clone)]
pub struct MonitorService {
    store: Store,
    transcripts: Arc<dyn TranscriptFeed>,
    version: String,
    started: Instant,
    next_subscriber: Arc<AtomicU64>,
    tracker: TaskTracker,
    cancel: CancellationToken,
}

impl MonitorService {
    /// A service over `store`, reading transcripts through `transcripts`.
    /// Stream tasks run on `tracker` and end when `cancel` fires.
    pub fn new(
        store: Store,
        transcripts: Arc<dyn TranscriptFeed>,
        version: String,
        tracker: TaskTracker,
        cancel: CancellationToken,
    ) -> Self {
        Self {
            store,
            transcripts,
            version,
            started: Instant::now(),
            next_subscriber: Arc::new(AtomicU64::new(1)),
            tracker,
            cancel,
        }
    }

    /// The collector's status.
    pub fn status(&self) -> MonitorStatus {
        MonitorStatus {
            protocol: PROTOCOL,
            version: self.version.clone(),
            uptime: self.started.elapsed(),
            sources: self.store.sources(),
            subscribers: u32::try_from(self.store.subscribers()).unwrap_or(u32::MAX),
        }
    }
}

type ResponseStream<T> = Pin<Box<dyn Stream<Item = Result<T, tonic::Status>> + Send>>;

#[tonic::async_trait]
impl wire::agent_monitor_server::AgentMonitor for MonitorService {
    type SubscribeStream = ResponseStream<wire::Update>;
    type FollowTranscriptStream = ResponseStream<wire::TranscriptItem>;

    async fn subscribe(
        &self,
        request: tonic::Request<wire::SubscribeRequest>,
    ) -> Result<tonic::Response<Self::SubscribeStream>, tonic::Status> {
        let subscriber = self.next_subscriber.fetch_add(1, Ordering::Relaxed);
        let span = tracing::info_span!(
            "macrod.monitor.rpc.subscribe",
            subscriber,
            agents = tracing::field::Empty,
            lagged = tracing::field::Empty,
        );
        trace_context::set_parent(&span, request.metadata());

        let (sender, receiver) = mpsc::channel(STREAM_BUFFER);
        let store = self.store.clone();
        let cancel = self.cancel.clone();
        let task_span = span.clone();
        self.tracker.spawn(
            async move {
                let lagged = forward_updates(store, sender, cancel).await;
                task_span.record("lagged", lagged);
            }
            .instrument(span),
        );
        Ok(tonic::Response::new(Box::pin(ReceiverStream::new(
            receiver,
        ))))
    }

    async fn follow_transcript(
        &self,
        request: tonic::Request<wire::TranscriptRequest>,
    ) -> Result<tonic::Response<Self::FollowTranscriptStream>, tonic::Status> {
        let span = tracing::info_span!(
            "macrod.monitor.rpc.follow_transcript",
            agent_id = %request.get_ref().agent_id,
            items = tracing::field::Empty,
        );
        trace_context::set_parent(&span, request.metadata());

        let request = request.into_inner();
        let agent_id = AgentId::from_wire(request.agent_id);
        let agent = self
            .store
            .agent(&agent_id)
            .ok_or_else(|| tonic::Status::not_found("no such agent"))?;
        let tail = match usize::try_from(request.tail) {
            Ok(0) | Err(_) => DEFAULT_TAIL,
            Ok(tail) => tail,
        };
        let mut items = self
            .transcripts
            .follow(&agent, tail)
            .instrument(span.clone())
            .await
            .map_err(|error| match error {
                TranscriptError::Unavailable => {
                    tonic::Status::failed_precondition("this agent has no readable transcript")
                }
                TranscriptError::Internal(report) => {
                    tracing::warn!(parent: &span, error = ?report, "transcript read failed");
                    tonic::Status::internal("transcript read failed")
                }
            })?;

        let (sender, receiver) = mpsc::channel(STREAM_BUFFER);
        let cancel = self.cancel.clone();
        let task_span = span.clone();
        self.tracker.spawn(
            async move {
                let mut sent: u64 = 0;
                loop {
                    let item = tokio::select! {
                        () = cancel.cancelled() => break,
                        () = sender.closed() => break,
                        item = items.next() => item,
                    };
                    let Some(item) = item else { break };
                    if sender.send(Ok((&item).into())).await.is_err() {
                        break;
                    }
                    sent += 1;
                }
                task_span.record("items", sent);
            }
            .instrument(span),
        );
        Ok(tonic::Response::new(Box::pin(ReceiverStream::new(
            receiver,
        ))))
    }

    async fn status(
        &self,
        _request: tonic::Request<wire::StatusRequest>,
    ) -> Result<tonic::Response<wire::DaemonStatus>, tonic::Status> {
        let status = self.status();
        Ok(tonic::Response::new(wire::DaemonStatus {
            protocol: status.protocol,
            version: status.version,
            uptime_ms: u64::try_from(status.uptime.as_millis()).unwrap_or(u64::MAX),
            sources: status.sources.iter().map(Into::into).collect(),
            subscribers: status.subscribers,
        }))
    }
}

/// Sends a snapshot, then every update. A subscriber that falls behind gets a
/// fresh snapshot and continues from it. Returns how often it lagged.
async fn forward_updates(
    store: Store,
    sender: mpsc::Sender<Result<wire::Update, tonic::Status>>,
    cancel: CancellationToken,
) -> u32 {
    let mut lagged: u32 = 0;
    let mut subscription = store.subscribe();
    if let crate::domain::model::UpdateKind::Snapshot(snapshot) = &subscription.snapshot.kind {
        tracing::Span::current().record("agents", snapshot.agents.len());
    }
    if sender
        .send(Ok(subscription.snapshot.as_ref().into()))
        .await
        .is_err()
    {
        return lagged;
    }

    loop {
        let received = tokio::select! {
            () = cancel.cancelled() => return lagged,
            () = sender.closed() => return lagged,
            received = subscription.updates.recv() => received,
        };
        let update = match received {
            Ok(update) => update,
            Err(broadcast::error::RecvError::Lagged(_)) => {
                lagged += 1;
                subscription = store.subscribe();
                subscription.snapshot.clone()
            }
            Err(broadcast::error::RecvError::Closed) => return lagged,
        };
        if sender.send(Ok(update.as_ref().into())).await.is_err() {
            return lagged;
        }
    }
}
