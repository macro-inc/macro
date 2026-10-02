//! Role-oriented logical protocol connections.
//!
//! A connection hosts exactly one agent execution, so there is no routing
//! table: the single [`agent_client_protocol::Channel`] handed back by
//! [`ServerConnection::connect`] and [`RuntimeConnection::connect`] carries
//! all of this connection's ACP traffic.

use std::future::Future;
use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionConfigOption;
use agent_client_protocol::{Channel as AcpChannel, TransportFrame};
use futures::StreamExt;
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinSet;

use crate::domain::channel::Channel;
use crate::domain::schema::v0::{
    AcpMessage, ModelProbeResult, ReviewCaptureResult, SystemEvent, ToRuntimeMessage,
    ToServerMessage,
};

#[cfg(test)]
mod test;

/// The logical channel carried by an Agent Service's side of a connection.
pub type ServerChannel = Channel<ToRuntimeMessage, ToServerMessage>;
/// The logical channel carried by an Agent Runtime's side of a connection.
pub type RuntimeChannel = Channel<ToServerMessage, ToRuntimeMessage>;

/// Handles a system event delivered to an Agent Service.
///
/// Use `()` when the connection only carries ACP. It ignores any system event.
pub trait SystemEventHandler: Send + Sync + 'static {
    /// Observe a runtime or agent state transition.
    fn handle(&self, event: SystemEvent) -> impl Future<Output = ()> + Send;
}

impl SystemEventHandler for () {
    fn handle(&self, _event: SystemEvent) -> impl Future<Output = ()> + Send {
        std::future::ready(())
    }
}

/// Handles connection-level requests to inspect a fresh ACP subprocess.
pub trait ModelProbeHandler: Send + Sync + 'static {
    /// Return the raw `session/new` options or a safe error message.
    fn probe(&self) -> impl Future<Output = Result<Vec<SessionConfigOption>, String>> + Send;
}

impl ModelProbeHandler for () {
    async fn probe(&self) -> Result<Vec<SessionConfigOption>, String> {
        Err("model probing is not configured on this runtime".to_owned())
    }
}

/// Captures workspace code separately from ACP messages and tool text.
pub trait ReviewCaptureHandler: Send + Sync + 'static {
    /// The service supplies the persisted workspace; implementations constrain its root.
    fn capture(
        &self,
        workspace: String,
        base: Option<String>,
        head: Option<String>,
    ) -> impl Future<Output = ReviewCaptureResult> + Send;
}

impl ReviewCaptureHandler for () {
    async fn capture(
        &self,
        _: String,
        _: Option<String>,
        _: Option<String>,
    ) -> ReviewCaptureResult {
        ReviewCaptureResult::Error { message: "This runtime does not expose workspace review snapshots; update macrod or link a pull request".into() }
    }
}

/// A failure while using a logical protocol connection.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ConnectionError {
    /// The logical connection has closed.
    #[error("connection closed")]
    Closed,
}

/// Agent Service-side access to one logical runtime connection.
pub struct ServerConnection {
    driver: tokio::task::AbortHandle,
}

impl ServerConnection {
    /// Attach the service role to a logical message channel.
    ///
    /// Returns the connection handle alongside an official ACP
    /// [`AcpChannel`] for the single agent execution this connection hosts.
    #[must_use]
    pub fn connect<H>(channel: ServerChannel, system_events: H) -> (Self, AcpChannel)
    where
        H: SystemEventHandler,
    {
        let Channel {
            tx: outbound,
            rx: inbound,
        } = channel;
        let (acp, acp_driver) = AcpChannel::duplex();
        let driver =
            tokio::spawn(run_server(inbound, outbound, system_events, acp_driver)).abort_handle();

        (Self { driver }, acp)
    }
}

impl Drop for ServerConnection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

/// Agent Runtime-side access to one logical service connection.
pub struct RuntimeConnection {
    outbound: UnboundedSender<ToServerMessage>,
    driver: tokio::task::JoinHandle<()>,
}

impl RuntimeConnection {
    /// Attach the runtime role to a logical message channel.
    ///
    /// Returns the connection handle alongside an official ACP
    /// [`AcpChannel`] for the single agent execution this connection hosts.
    #[must_use]
    pub fn connect(channel: RuntimeChannel) -> (Self, AcpChannel) {
        Self::connect_with_model_probe_handler(channel, ())
    }

    /// Attach the runtime role and handle model probes outside the primary ACP
    /// process. Every request is allowed to run concurrently.
    #[must_use]
    pub fn connect_with_model_probe_handler<H>(
        channel: RuntimeChannel,
        model_probes: H,
    ) -> (Self, AcpChannel)
    where
        H: ModelProbeHandler,
    {
        Self::connect_with_handlers(channel, model_probes, ())
    }

    /// Attach independent model and review capabilities to the runtime connection.
    #[must_use]
    pub fn connect_with_handlers<H: ModelProbeHandler, R: ReviewCaptureHandler>(
        channel: RuntimeChannel,
        model_probes: H,
        reviews: R,
    ) -> (Self, AcpChannel) {
        let Channel {
            tx: outbound,
            rx: inbound,
        } = channel;
        let (acp, acp_driver) = AcpChannel::duplex();
        let driver = tokio::spawn(run_runtime(
            inbound,
            outbound.clone(),
            acp_driver,
            Arc::new(model_probes),
            Arc::new(reviews),
        ));
        (Self { outbound, driver }, acp)
    }

    /// Wait for the service transport to close, independently of the ACP peer.
    /// Callers can cancel an idle ACP subprocess when the service goes away.
    pub async fn closed(&mut self) {
        if !self.driver.is_finished() {
            let _ = (&mut self.driver).await;
        }
    }

    /// Send a system event notification to the Agent Service.
    pub fn system_event(&self, event: SystemEvent) -> Result<(), ConnectionError> {
        self.outbound
            .send(ToServerMessage::Event { event })
            .map_err(|_| ConnectionError::Closed)
    }
}

impl Drop for RuntimeConnection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

async fn run_server<H>(
    mut inbound: tokio::sync::mpsc::UnboundedReceiver<ToServerMessage>,
    outbound: UnboundedSender<ToRuntimeMessage>,
    system_events: H,
    mut acp: AcpChannel,
) where
    H: SystemEventHandler,
{
    // Whether the caller's ACP channel is still open. A caller that only
    // wants events is free to drop its ACP channel immediately; that must
    // not tear down event handling, so once the ACP side closes we simply
    // stop selecting on it instead of breaking the loop.
    let mut acp_open = true;
    loop {
        tokio::select! {
            message = inbound.recv() => {
                let Some(message) = message else {
                    break;
                };
                match message {
                    ToServerMessage::Event { event } => {
                        system_events.handle(event).await;
                    }
                    ToServerMessage::Acp(AcpMessage(raw)) => {
                        if acp_open
                            && acp.tx.unbounded_send(TransportFrame::Single(raw)).is_err()
                        {
                            acp_open = false;
                        }
                    }
                    ToServerMessage::ModelProbeResponse { .. } => {
                        tracing::warn!("dropping a model probe response without a probe waiter");
                    }
                    ToServerMessage::ReviewCaptured { .. } | ToServerMessage::ReviewCaptureChunk { .. } => {
                        tracing::warn!("dropping a review response without a capture waiter");
                    }
                }
            }
            message = acp.rx.next(), if acp_open => {
                match message {
                    Some(TransportFrame::Single(raw)) => {
                        if outbound.send(ToRuntimeMessage::Acp(AcpMessage(raw))).is_err() {
                            break;
                        }
                    }
                    // This connection carries exactly one `AcpMessage` per
                    // outer envelope value, so there is no envelope shape to
                    // relay a batch or a malformed frame as. Neither has ever
                    // been observed here in practice - batching is opt-in on
                    // the wire and nothing on either side of this relay asks
                    // for it - so this keeps the old behaviour: anything that
                    // is not a single message closes this side, same as a
                    // stream that ended or a transport error used to.
                    _ => acp_open = false,
                }
            }
        }
    }
}

async fn run_runtime<H, R>(
    mut inbound: tokio::sync::mpsc::UnboundedReceiver<ToRuntimeMessage>,
    outbound: UnboundedSender<ToServerMessage>,
    mut acp: AcpChannel,
    model_probes: Arc<H>,
    reviews: Arc<R>,
) where
    H: ModelProbeHandler,
    R: ReviewCaptureHandler,
{
    // See the matching comment in `run_server`: dropping the ACP channel must
    // not tear down this connection - only an actual transport failure does.
    let mut acp_open = true;
    // Owned by the connection driver: dropping the runtime connection aborts
    // every subprocess-backed probe still in flight.
    let mut probes = JoinSet::new();
    loop {
        tokio::select! {
            message = inbound.recv() => {
                let Some(message) = message else {
                    break;
                };
                match message {
                    ToRuntimeMessage::Acp(AcpMessage(raw)) => {
                        if acp_open
                            && acp.tx.unbounded_send(TransportFrame::Single(raw)).is_err()
                        {
                            acp_open = false;
                        }
                    }
                    ToRuntimeMessage::ModelProbeRequest => {
                        let model_probes = Arc::clone(&model_probes);
                        let outbound = outbound.clone();
                        probes.spawn(async move {
                            let result = match model_probes.probe().await {
                                Ok(config_options) => {
                                    ModelProbeResult::Available { config_options }
                                }
                                Err(message) => ModelProbeResult::Error { message },
                            };
                            let _ = outbound.send(ToServerMessage::ModelProbeResponse { result });
                        });
                    }
                    ToRuntimeMessage::ReviewCapture { request_id, workspace, base, head } => {
                        let reviews = Arc::clone(&reviews);
                        let outbound = outbound.clone();
                        probes.spawn(async move {
                            let result = reviews.capture(workspace, base, head).await;
                            send_review_capture(&outbound, request_id, result).await;
                        });
                    }
                }
            }
            result = probes.join_next(), if !probes.is_empty() => {
                if let Some(Err(error)) = result {
                    tracing::warn!(%error, "model probe task failed");
                }
            }
            message = acp.rx.next(), if acp_open => {
                match message {
                    Some(TransportFrame::Single(raw)) => {
                        if outbound.send(ToServerMessage::Acp(AcpMessage(raw))).is_err() {
                            break;
                        }
                    }
                    // See the matching comment in `run_server`.
                    _ => acp_open = false,
                }
            }
        }
    }
}

/// Bound each frame below WebSocket limits and yield between chunks so ACP remains responsive.
async fn send_review_capture(
    outbound: &tokio::sync::mpsc::UnboundedSender<ToServerMessage>,
    request_id: String,
    result: ReviewCaptureResult,
) {
    let result = match result {
        ReviewCaptureResult::Available { capture } => {
            match tokio::task::spawn_blocking(move || serde_json::to_string(&capture)).await {
                Ok(Ok(json)) if json.len() <= 256 * 1024 * 1024 => {
                    let mut start = 0;
                    while start < json.len() {
                        let mut end = (start + 256 * 1024).min(json.len());
                        while !json.is_char_boundary(end) {
                            end -= 1;
                        }
                        if outbound
                            .send(ToServerMessage::ReviewCaptureChunk {
                                request_id: request_id.clone(),
                                chunk: json[start..end].to_owned(),
                                done: end == json.len(),
                            })
                            .is_err()
                        {
                            return;
                        }
                        start = end;
                        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
                    }
                    return;
                }
                _ => ReviewCaptureResult::Error {
                    message: "Structural capture exceeds the 256 MiB transfer budget".into(),
                },
            }
        }
        error => error,
    };
    let _ = outbound.send(ToServerMessage::ReviewCaptured { request_id, result });
}
