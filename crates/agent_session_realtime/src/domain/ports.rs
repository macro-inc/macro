//! Ports for log-frame fan-out.

use std::future::Future;

use agent_session::domain::events::LogAppendedMetadata;
use agent_session::domain::model::{AgentSessionId, StoredAgentSessionLog};
use rootcause::Report;

/// Receives runs of appended frames from wherever the harness published them.
pub trait AgentSessionLogConsumer: Send + Sync + 'static {
    /// Waits for and returns the next appended run.
    fn recv(&self) -> impl Future<Output = Result<LogAppendedMetadata, Report>> + Send;
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
