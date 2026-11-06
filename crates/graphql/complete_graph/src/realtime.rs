//! Where a log subscription gets its frames: request data the composition
//! root fills, so the schema needs no type parameter for it.

use std::sync::Arc;

use agent_session::domain::model::{AgentSessionId, StoredAgentSessionLog};
use agent_session_realtime::domain::ports::AgentSessionLogSubscriptionService;

/// The fan-out a `agentSessionLogAppended` subscription draws from.
#[derive(Clone)]
pub struct AgentSessionLogSubscriptions(Arc<dyn AgentSessionLogSubscriptionService>);

impl AgentSessionLogSubscriptions {
    /// Subscribe to runs appended to `session_id` from now on.
    #[must_use]
    pub fn subscribe(
        &self,
        session_id: AgentSessionId,
    ) -> tokio::sync::mpsc::Receiver<Vec<StoredAgentSessionLog>> {
        self.0.subscribe(session_id)
    }
}

/// Request data for log subscriptions, over `service`.
pub fn agent_session_log_subscriptions(
    service: impl AgentSessionLogSubscriptionService,
) -> AgentSessionLogSubscriptions {
    AgentSessionLogSubscriptions(Arc::new(service))
}
