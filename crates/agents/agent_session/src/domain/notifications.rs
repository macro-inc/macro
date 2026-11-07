//! Durable system-event production and leased delivery contracts.
use super::{error::Result, model::AgentSessionId};
use agent_runtime_protocol::domain::{
    action::AgentActionId,
    notification::{Notification, NotificationEvent},
};
use macro_uuid::Uuid;
use serde_json::{Map, Value};
use std::{future::Future, pin::Pin};

/// Object-safe future used by the outbox ports.
pub type NotificationFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

/// A producer command. Services author typed events, never model prompts.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProduceNotification {
    /// Target session.
    pub session_id: AgentSessionId,
    /// Subject whose state changed.
    pub subject_id: String,
    /// Typed facts.
    pub event: NotificationEvent,
    /// Override for subjects with several independent changes.
    pub dedupe_key: Option<String>,
    /// Whether the event should start an otherwise idle turn.
    pub wake: bool,
}

/// State captured once when producing a notification, including trace context.
#[derive(Debug, Clone)]
pub struct PendingNotification {
    /// Target session.
    pub session_id: AgentSessionId,
    /// Durable event.
    pub notification: Notification,
    /// Session-scoped idempotency key.
    pub dedupe_key: String,
    /// Idle-session delivery policy.
    pub wake: bool,
    /// Producer span's propagated trace context.
    pub producer_context: Map<String, Value>,
}

impl PendingNotification {
    /// Validate a bounded event and capture its producing span.
    #[tracing::instrument(name = "agent.notification.produce", skip_all, fields(session_id = %input.session_id, kind = input.event.kind()), err)]
    pub fn new(input: ProduceNotification) -> Result<Self> {
        let dedupe_key = input
            .dedupe_key
            .unwrap_or_else(|| format!("{}:{}", input.event.kind(), input.subject_id));
        if input.subject_id.is_empty()
            || input.subject_id.len() > 512
            || dedupe_key.is_empty()
            || dedupe_key.len() > 1024
            || serde_json::to_vec(&input.event)
                .map_err(|error| super::error::AgentSessionError::Unknown(error.into()))?
                .len()
                > 64 * 1024
        {
            return Err(super::error::AgentSessionError::Forbidden);
        }
        let mut producer_context = Map::new();
        genai_telemetry::propagation::inject(&tracing::Span::current(), &mut producer_context);
        Ok(Self {
            session_id: input.session_id,
            notification: Notification {
                id: macro_uuid::generate_uuid_v7(),
                subject_id: input.subject_id,
                created_at: chrono::Utc::now().to_rfc3339(),
                event: input.event,
            },
            dedupe_key,
            wake: input.wake,
            producer_context,
        })
    }
}

/// Transaction-aware producer port. The caller supplies its own transaction;
/// implementations live in the table's owning crate. No domain depends on SQLx.
pub trait NotificationWriter<Transaction>: Send + Sync {
    /// Insert idempotently inside the producer's state-change transaction.
    fn produce<'a>(
        &'a self,
        transaction: &'a mut Transaction,
        notification: &'a PendingNotification,
    ) -> NotificationFuture<'a, ()>;
}

/// One claimed batch, protected from stale acknowledgments by its lease token.
#[derive(Debug, Clone)]
pub struct NotificationBatch {
    /// Delivery lease.
    pub lease_id: Uuid,
    /// Stable action identity retained across retries of a batch.
    pub action_id: AgentActionId,
    /// Whether this batch contains an event allowed to start a system turn.
    pub wake: bool,
    /// Events in production order. Empty only for an unreadable bound action:
    /// reconcile its original invocation before attempting to deliver any input.
    pub notifications: Vec<Notification>,
    /// Original contexts for span links.
    pub producer_contexts: Vec<Map<String, Value>>,
}

/// Delivery result persisted for producers and incident investigation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationOutcome {
    /// A turn accepted these events.
    Delivered,
    /// A notification-only turn had nothing to add.
    Noop,
}

/// Object-safe outbox used by the serialized harness worker.
pub trait NotificationStore: Send + Sync + 'static {
    /// Up to 100 sessions with waking events or prior attempts, ordered after
    /// this cursor. Callers advance even when delivery fails and wrap at the end.
    fn pending_sessions(
        &self,
        after: Option<AgentSessionId>,
    ) -> NotificationFuture<'_, Vec<AgentSessionId>>;
    /// Claim up to 100 events, reconciling prior attempts before fresh inputs.
    /// Unclaimed quiet events wait for a real prompt; an active lease blocks
    /// later batches for the session. Claims strip matching legacy background
    /// actions of their former user authority before returning.
    fn claim(
        &self,
        session: AgentSessionId,
        real_prompt: bool,
    ) -> NotificationFuture<'_, Option<NotificationBatch>>;
    /// Bind a claimed batch to the real prompt that will carry it.
    fn bind_action(&self, lease: Uuid, action: AgentActionId) -> NotificationFuture<'_, ()>;
    /// Defer a reconciled, interrupted quiet batch to the next real prompt.
    /// Its former action association is cleared only after checking the log.
    fn defer_until_prompt(&self, lease: Uuid) -> NotificationFuture<'_, ()>;
    /// Extend a lease while its turn runs.
    fn renew(&self, lease: Uuid) -> NotificationFuture<'_, ()>;
    /// Acknowledge only the current lease; stale workers cannot consume retries.
    fn complete(&self, lease: Uuid, outcome: NotificationOutcome) -> NotificationFuture<'_, ()>;
    /// Return a failed dispatch for immediate retry without losing its action id.
    fn release(&self, lease: Uuid) -> NotificationFuture<'_, ()>;
    /// Independent producers enqueue idempotently through an internal API.
    fn enqueue(&self, notification: PendingNotification) -> NotificationFuture<'_, ()>;
}

/// Internal producer use case. Public session controls cannot produce events.
pub struct NotificationService(pub std::sync::Arc<dyn NotificationStore>);
impl NotificationService {
    /// Persist a bounded, typed event idempotently.
    #[tracing::instrument(skip_all, fields(session_id = %input.session_id, kind = input.event.kind()), err)]
    pub async fn produce(&self, input: ProduceNotification) -> Result<()> {
        self.0.enqueue(PendingNotification::new(input)?).await
    }
}

#[cfg(test)]
mod test;
