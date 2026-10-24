//! Durable inbound: the client's event handler stores each adopted-group
//! event (one fenced insert) before the protocol node is acknowledged, and
//! the account runner ingests the queue afterwards.

use std::collections::HashSet;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use whatsapp_linked::domain::events::{InboundEvent, SessionScope};
use whatsapp_linked::domain::models::LinkedError;
use whatsapp_linked::domain::ports::LinkedResult;
use whatsapp_linked::domain::session::SessionService;

use super::ports::InboundSink;

#[cfg(test)]
mod test;

/// What the gate needs from the linked-devices domain.
pub trait InboundStore: Send + Sync + 'static {
    /// Groups the account observes now.
    fn observed_groups(
        &self,
        scope: SessionScope,
    ) -> impl Future<Output = LinkedResult<Vec<String>>> + Send;

    /// Stores an event durably for later ingestion.
    fn enqueue_inbound(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> impl Future<Output = LinkedResult<()>> + Send;
}

impl InboundStore for SessionService {
    async fn observed_groups(&self, scope: SessionScope) -> LinkedResult<Vec<String>> {
        SessionService::observed_groups(self, scope).await
    }

    async fn enqueue_inbound(&self, scope: SessionScope, event: &InboundEvent) -> LinkedResult<()> {
        SessionService::enqueue_inbound(self, scope, event).await
    }
}

#[derive(Default)]
struct Observed {
    groups: HashSet<String>,
    /// Ticket of the load `groups` came from (0: never loaded).
    loaded_ticket: u64,
}

/// Filters group events to adopted groups and enqueues them durably.
///
/// Adopted groups stay cached until [`InboundGate::reload`]
/// (`whatsapp_account_changed`). A miss never trusts the cache: it waits for
/// a load that started after the event arrived (joining one already in
/// flight, or starting one), so an adoption that committed just before the
/// event is always seen.
pub struct InboundGate<Store = SessionService> {
    store: Store,
    scope: SessionScope,
    /// Locked across a load, so concurrent misses share one read.
    observed: Mutex<Observed>,
    /// Tickets handed to loads in start order.
    load_tickets: AtomicU64,
    /// Woken after an event is enqueued.
    pub(crate) queued: Notify,
    /// Cancelled when a write was fenced: the account must stop.
    pub(crate) fenced: CancellationToken,
}

impl<Store: InboundStore> InboundGate<Store> {
    /// A gate for the account the lease `scope` holds.
    pub fn new(store: Store, scope: SessionScope) -> Self {
        InboundGate {
            store,
            scope,
            observed: Mutex::new(Observed::default()),
            load_tickets: AtomicU64::new(0),
            queued: Notify::new(),
            fenced: CancellationToken::new(),
        }
    }

    /// Re-reads the adopted groups.
    pub(crate) async fn reload(&self) {
        let mut observed = self.observed.lock().await;
        self.reload_locked(&mut observed).await;
    }

    /// `false` when the adopted groups could not be read.
    async fn reload_locked(&self, observed: &mut Observed) -> bool {
        let ticket = self.load_tickets.fetch_add(1, Ordering::SeqCst) + 1;
        match self.store.observed_groups(self.scope).await {
            Ok(groups) => {
                observed.groups = groups.into_iter().collect();
                observed.loaded_ticket = ticket;
                tracing::debug!(
                    name: "whatsapp.observed_groups.reloaded",
                    account_id = %self.scope.account_id,
                    count = observed.groups.len(),
                    "Reloaded the WhatsApp groups this account observes"
                );
                true
            }
            Err(report) => {
                if matches!(report.current_context(), LinkedError::Fenced) {
                    self.fenced.cancel();
                } else {
                    tracing::warn!(
                        code = report.current_context().code(),
                        error = ?report,
                        "Reading the adopted WhatsApp groups failed"
                    );
                }
                false
            }
        }
    }

    /// Whether the group is adopted, `None` when that could not be decided.
    async fn observes(&self, group_jid: &str) -> Option<bool> {
        // Loads with a later ticket started after this event arrived.
        let arrived = self.load_tickets.load(Ordering::SeqCst);
        let mut observed = self.observed.lock().await;
        if observed.groups.contains(group_jid) {
            return Some(true);
        }
        // A load that started after arrival finished while we waited for the
        // lock: its answer is fresh enough. Otherwise load now.
        if observed.loaded_ticket <= arrived && !self.reload_locked(&mut observed).await {
            return None;
        }
        Some(observed.groups.contains(group_jid))
    }
}

// Object safe for the client's event handler, hence `async_trait`.
#[async_trait::async_trait]
impl<Store: InboundStore> InboundSink for InboundGate<Store> {
    async fn accept(&self, event: &InboundEvent) -> bool {
        if self.fenced.is_cancelled() {
            return false;
        }
        // Undecided (or fenced) leaves the node unacknowledged for redelivery.
        let Some(observed) = self.observes(&event.group_jid).await else {
            return false;
        };
        let span = tracing::info_span!(
            "whatsapp.inbound.ingest",
            account_id = %self.scope.account_id,
            event_id = %event.event_id,
            observed,
            outcome = tracing::field::Empty,
        );
        if !observed {
            span.record("outcome", "dropped");
            tracing::debug!(
                name: "whatsapp.inbound.skipped",
                parent: &span,
                account_id = %self.scope.account_id,
                event_id = %event.event_id,
                reason = "group_not_adopted",
                "Acknowledged a WhatsApp event without storing it"
            );
            return true;
        }
        match self
            .store
            .enqueue_inbound(self.scope, event)
            .instrument(span.clone())
            .await
        {
            Ok(()) => {
                span.record("outcome", "queued");
                self.queued.notify_one();
                true
            }
            Err(report) => {
                let error = report.current_context();
                span.record("outcome", error.code());
                match error {
                    LinkedError::Fenced => self.fenced.cancel(),
                    // Invalid events are never storable; ack so they are not
                    // redelivered forever.
                    LinkedError::Invalid(_) => {
                        tracing::debug!(
                            name: "whatsapp.inbound.skipped",
                            parent: &span,
                            account_id = %self.scope.account_id,
                            event_id = %event.event_id,
                            reason = "invalid_event",
                            "Acknowledged a WhatsApp event without storing it"
                        );
                        return true;
                    }
                    _ => tracing::warn!(
                        code = error.code(),
                        "Queueing a WhatsApp event failed; leaving it unacknowledged"
                    ),
                }
                false
            }
        }
    }
}
