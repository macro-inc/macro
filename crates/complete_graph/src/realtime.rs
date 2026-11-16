//! Where a log subscription gets its frames: request data the composition
//! root fills, so the schema needs no type parameter for it.

use std::collections::HashMap;
use std::sync::Arc;

use activity::ActivityRecord;
use agent_correlation::{domain::CorrelationRepository as _, outbound::PgCorrelationRepository};
use agent_session::domain::model::{AgentSessionId, StoredAgentSessionLog};
use agent_session_realtime::domain::ports::AgentSessionLogSubscriptionService;
use uuid::Uuid;

/// One resolved correlation, initialized at most once per pod.
type CachedSession = Arc<tokio::sync::OnceCell<Option<Uuid>>>;
/// Bounded shared cache of correlation-to-session lookups.
type SessionLookupCache = Arc<tokio::sync::Mutex<HashMap<Uuid, CachedSession>>>;

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

/// Correlated activity fan-out and lookup used by session subscriptions.
#[derive(Clone)]
pub struct AgentSessionActivitySubscriptions {
    /// Factory for receiving correlated rows from the activity consumer.
    service: Arc<dyn Fn() -> tokio::sync::broadcast::Receiver<Arc<ActivityRecord>> + Send + Sync>,
    /// Authoritative correlation mapping store.
    repository: PgCorrelationRepository,
    /// Shared bounded cache of already resolved mappings.
    sessions: SessionLookupCache,
}

impl AgentSessionActivitySubscriptions {
    /// Subscribe before any session lookup, avoiding a read-to-subscribe gap.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<Arc<ActivityRecord>> {
        (self.service)()
    }

    /// Resolve one correlation through the authoritative mapping table.
    #[tracing::instrument(skip(self), err)]
    pub async fn session_for_correlation(
        &self,
        correlation_id: uuid::Uuid,
    ) -> Result<Option<uuid::Uuid>, agent_correlation::domain::CorrelationError> {
        let cell = {
            let mut sessions = self.sessions.lock().await;
            // Correlation IDs are immutable. Bound memory across long-lived pods.
            if !sessions.contains_key(&correlation_id) && sessions.len() >= 4096 {
                sessions.clear();
            }
            Arc::clone(sessions.entry(correlation_id).or_default())
        };
        let session = cell
            .get_or_try_init(|| async {
                self.repository
                    .find(correlation_id)
                    .await
                    .map(|mapping| mapping.map(|item| item.session_id))
            })
            .await?;
        Ok(*session)
    }
}

/// Build the session activity subscription bridge over the activity consumer.
pub fn agent_session_activity_subscriptions<C>(
    service: Arc<activity::ActivityRealtimeConsumerService<C>>,
    pool: sqlx::PgPool,
) -> AgentSessionActivitySubscriptions
where
    C: activity::ActivityTopicEventConsumer,
{
    AgentSessionActivitySubscriptions {
        service: Arc::new(move || service.subscribe_session_rows()),
        repository: PgCorrelationRepository(pool),
        sessions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
    }
}
