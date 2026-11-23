use super::*;
use email::domain::{
    backfill_jobs::{
        BackfillJobQueue, BackfillJobRepository, BackfillJobService, ConnectedInboxEvents,
        ConnectedInboxHistory, InitialBackfillError,
    },
    events::{EmailMacroEvent, LinkConnectedMetadata},
};
use macro_event_broker::MacroEventBroker;
use std::sync::Arc;

pub struct InitialConnectionBackfill<R, Q, H, E> {
    pub jobs: Arc<BackfillJobService<R, Q>>,
    pub history: H,
    pub events: E,
}

impl<R, Q, H, E> ConnectionBackfill for InitialConnectionBackfill<R, Q, H, E>
where
    R: BackfillJobRepository,
    R::Err: ConnectionSourceError,
    Q: BackfillJobQueue,
    H: ConnectedInboxHistory,
    E: ConnectedInboxEvents,
{
    async fn start(&self, link: &Link) -> Result<Uuid, ConnectionError> {
        self.jobs
            .start_connected(link, &self.history, &self.events)
            .await
            .map_err(|error| match error {
                InitialBackfillError::Active(e) => ConnectionError::DatabaseError(
                    e.into_original()
                        .context("Failed to check for an in-flight backfill job"),
                ),
                InitialBackfillError::Insert(e) => ConnectionError::DatabaseError(
                    e.into_original().context("Failed to create backfill job"),
                ),
                InitialBackfillError::ConflictLookup(e) => ConnectionError::DatabaseError(
                    e.into_original()
                        .context("Failed to fetch in-flight backfill job after insert conflict"),
                ),
                InitialBackfillError::MissingActive => ConnectionError::DatabaseError(
                    anyhow::anyhow!("backfill insert conflicted but no active job found"),
                ),
                InitialBackfillError::FailureState(e) => ConnectionError::DatabaseError(
                    e.into_original()
                        .context("Failed to persist initial backfill publication failure"),
                ),
                InitialBackfillError::Enqueue => ConnectionError::EnqueueError,
            })
    }
}

pub struct ConnectionHistory(pub sqlx::PgPool);

impl ConnectedInboxHistory for ConnectionHistory {
    async fn record(&self, link: &Link) {
        email_db_client::links_history::insert::insert_email_link_history(
            &self.0,
            link.id,
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            link.provider,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, link_id=?link.id, "Failed to insert email link history");
        })
        .ok();
    }
}

pub struct ConnectionEvents<B>(pub B);

impl<B: MacroEventBroker> ConnectedInboxEvents for ConnectionEvents<B> {
    fn connected(&self, link: &Link) {
        crate::pubsub::publish_email_event(
            &self.0,
            &EmailMacroEvent::link_connected(LinkConnectedMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                email_address: link.email_address.0.as_ref().to_string(),
                provider: link.provider.as_str().to_string(),
                is_primary: link.is_primary,
                connected_at: link.created_at,
            }),
        );
    }
}
