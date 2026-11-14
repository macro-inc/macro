//! The viewer's side of the socket: a typed client, and a [`watch`] stream
//! that stays connected, reconnecting with backoff.

use std::path::{Path, PathBuf};
use std::time::Duration;

use futures::{Stream, StreamExt as _};
use hyper_util::rt::TokioIo;
use tokio::net::UnixStream;
use tokio_util::sync::CancellationToken;
use tonic::service::interceptor::InterceptedService;
use tonic::transport::{Channel, Endpoint};
use tracing::Instrument as _;

use crate::domain::model::{AgentId, MonitorStatus, SourceHealth, TranscriptItem, Update};
use crate::proto::{PROTOCOL, WireError, wire};
use crate::trace_context::TraceContextInterceptor;

/// A placeholder URI: the connector ignores it and dials the socket.
const SOCKET_URI: &str = "http://monitor.sock";

const FIRST_BACKOFF: Duration = Duration::from_millis(250);

/// Silence after which a connection counts as stalled: three missed
/// heartbeats (the collector sends one every 15 s).
const STALL_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_BACKOFF: Duration = Duration::from_secs(5);

/// Why a call failed.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The socket could not be reached.
    #[error("cannot reach the monitor: {0}")]
    Connect(#[from] tonic::transport::Error),
    /// The collector answered with an error.
    #[error("monitor call failed: {0}")]
    Call(#[from] tonic::Status),
    /// The collector sent something this build cannot read.
    #[error("unreadable monitor message: {0}")]
    Wire(#[from] WireError),
}

type Inner = wire::agent_monitor_client::AgentMonitorClient<
    InterceptedService<Channel, TraceContextInterceptor>,
>;

/// A connected client.
#[derive(Clone, Debug)]
pub struct MonitorClient {
    inner: Inner,
}

impl MonitorClient {
    /// Connects to the collector on `socket`.
    pub async fn connect(socket: &Path) -> Result<Self, ClientError> {
        let socket = socket.to_owned();
        let channel = Endpoint::from_static(SOCKET_URI)
            .connect_with_connector(tower::service_fn(move |_| {
                let socket = socket.clone();
                async move { UnixStream::connect(socket).await.map(TokioIo::new) }
            }))
            .await?;
        Ok(Self {
            inner: wire::agent_monitor_client::AgentMonitorClient::with_interceptor(
                channel,
                TraceContextInterceptor,
            ),
        })
    }

    /// A snapshot, then every update.
    pub async fn subscribe(
        &mut self,
    ) -> Result<impl Stream<Item = Result<Update, ClientError>> + use<>, ClientError> {
        let stream = self
            .inner
            .subscribe(wire::SubscribeRequest {})
            .await?
            .into_inner();
        Ok(stream.map(|update| Ok(Update::try_from(update?)?)))
    }

    /// The last `tail` transcript items of an agent (0 for the collector's
    /// default), then every new one.
    pub async fn follow_transcript(
        &mut self,
        agent: &AgentId,
        tail: u32,
    ) -> Result<impl Stream<Item = Result<TranscriptItem, ClientError>> + use<>, ClientError> {
        let stream = self
            .inner
            .follow_transcript(wire::TranscriptRequest {
                agent_id: agent.as_str().to_owned(),
                tail,
            })
            .await?
            .into_inner();
        Ok(stream.map(|item| Ok(TranscriptItem::try_from(item?)?)))
    }

    /// The collector's status.
    pub async fn status(&mut self) -> Result<MonitorStatus, ClientError> {
        let status = self
            .inner
            .status(wire::StatusRequest {})
            .await?
            .into_inner();
        Ok(MonitorStatus {
            protocol: status.protocol,
            version: status.version,
            uptime: Duration::from_millis(status.uptime_ms),
            sources: status
                .sources
                .into_iter()
                .map(SourceHealth::try_from)
                .collect::<Result<_, _>>()?,
            subscribers: status.subscribers,
        })
    }
}

/// What a [`watch`] stream reports.
#[derive(Clone, Debug, PartialEq)]
pub enum ClientEvent {
    /// Connected; a snapshot follows.
    Connected(MonitorStatus),
    /// An update. After a reconnect the first one is a snapshot.
    Update(Box<Update>),
    /// The connection dropped or could not be made; retrying after the delay.
    Reconnecting {
        /// How long until the next attempt.
        retry_in: Duration,
        /// Why.
        reason: String,
    },
    /// The collector speaks another protocol version; the older side must be
    /// updated. The stream ends after this.
    Incompatible {
        /// The collector's protocol.
        protocol: u32,
    },
}

/// Stays subscribed to the collector on `socket` until `cancel` fires,
/// reconnecting with backoff (250 ms doubling to 5 s, reset after a
/// successful subscribe).
pub fn watch(socket: PathBuf, cancel: CancellationToken) -> impl Stream<Item = ClientEvent> {
    async_stream::stream! {
        let mut backoff = FIRST_BACKOFF;
        loop {
            let span = tracing::info_span!("macrod.monitor.viewer.connect");
            let connected = tokio::select! {
                () = cancel.cancelled() => return,
                connected = connect_and_subscribe(&socket).instrument(span) => connected,
            };

            let reason = match connected {
                Ok((status, _)) if status.protocol != PROTOCOL => {
                    yield ClientEvent::Incompatible { protocol: status.protocol };
                    return;
                }
                Ok((status, mut updates)) => {
                    backoff = FIRST_BACKOFF;
                    yield ClientEvent::Connected(status);
                    loop {
                        let next = tokio::select! {
                            () = cancel.cancelled() => return,
                            next = tokio::time::timeout(STALL_TIMEOUT, updates.next()) => next,
                        };
                        match next {
                            Ok(Some(Ok(update))) => yield ClientEvent::Update(Box::new(update)),
                            Ok(Some(Err(error))) => break error.to_string(),
                            Ok(None) => break String::from("the collector closed the stream"),
                            Err(_) => break String::from("the collector stopped answering"),
                        }
                    }
                }
                Err(error) => error.to_string(),
            };

            yield ClientEvent::Reconnecting { retry_in: backoff, reason };
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(backoff) => {}
            }
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
    }
}

type UpdateStream = std::pin::Pin<Box<dyn Stream<Item = Result<Update, ClientError>> + Send>>;

async fn connect_and_subscribe(
    socket: &Path,
) -> Result<(MonitorStatus, UpdateStream), ClientError> {
    let mut client = MonitorClient::connect(socket).await?;
    let status = client.status().await?;
    let updates = client.subscribe().await?;
    Ok((status, Box::pin(updates)))
}
