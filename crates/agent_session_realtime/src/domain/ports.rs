//! Ports for log-frame fan-out.

use std::future::Future;

use agent_session::domain::events::LogAppendedMetadata;
use agent_session::domain::model::{AgentSessionId, StoredAgentSessionLog};
use rootcause::Report;

/// The transport's name for one delivery of a run, handed back to
/// acknowledge it. Opaque outside the adapter that minted it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DeliveryId(String);

impl DeliveryId {
    /// Wrap a transport's delivery id.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// The transport's delivery id.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for DeliveryId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One run as the transport delivered it.
#[derive(Debug, Clone)]
pub struct ReceivedRun {
    /// The frames.
    pub run: LogAppendedMetadata,
    /// What acknowledging this delivery takes.
    pub delivery: DeliveryId,
    /// Whether the transport delivered this run before without it being
    /// acknowledged: a subscriber may already hold some of its rows.
    pub redelivered: bool,
}

/// Receives runs of appended frames from wherever the harness published them,
/// at least once each.
///
/// A run stays owed to this process until it is acknowledged: a run received
/// but never acknowledged is delivered again, so a subscriber folds by row id
/// and tolerates seeing a row twice.
pub trait AgentSessionLogConsumer: Send + Sync + 'static {
    /// Waits for and returns the next run owed to this process.
    fn recv(&self) -> impl Future<Output = Result<ReceivedRun, Report>> + Send;

    /// Acknowledge a delivery once its run reached every subscriber it had,
    /// so it is not delivered again.
    fn ack(&self, delivery: &DeliveryId) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Session-scoped subscriptions to received runs of frames.
///
/// Object safe on purpose: the GraphQL schema holds it erased in request
/// data rather than as one more type parameter.
pub trait AgentSessionLogSubscriptionService: Send + Sync + 'static {
    /// Subscribes to runs appended to `session_id` from now on. The receiver
    /// closes when the subscriber falls too far behind; a closed receiver
    /// means rows were missed and the subscriber must refetch the log.
    fn subscribe(
        &self,
        session_id: AgentSessionId,
    ) -> tokio::sync::mpsc::Receiver<Vec<StoredAgentSessionLog>>;
}

impl<S> AgentSessionLogSubscriptionService for std::sync::Arc<S>
where
    S: AgentSessionLogSubscriptionService + ?Sized,
{
    fn subscribe(
        &self,
        session_id: AgentSessionId,
    ) -> tokio::sync::mpsc::Receiver<Vec<StoredAgentSessionLog>> {
        self.as_ref().subscribe(session_id)
    }
}

/// Subscriptions that never deliver, for when only the schema shape is needed.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpAgentSessionLogSubscriptionService;

impl AgentSessionLogSubscriptionService for NoOpAgentSessionLogSubscriptionService {
    fn subscribe(
        &self,
        _session_id: AgentSessionId,
    ) -> tokio::sync::mpsc::Receiver<Vec<StoredAgentSessionLog>> {
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);
        receiver
    }
}
