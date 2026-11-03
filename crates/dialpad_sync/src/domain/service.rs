use super::{mapping, models::*, ports::*};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use call::domain::imports::CallImportService;
use macro_user_id::user_id::MacroUserIdStr;
use rand::RngCore;
use std::sync::Arc;
use tracing::Instrument;
use uuid::Uuid;

/// Reconcile work per pass, so one pass never monopolizes the worker.
const RECONCILE_BATCH: i64 = 20;
/// An enrollment the user never finished in Macro Connect is dropped after this.
const ENROLLMENT_TTL: chrono::Duration = chrono::Duration::hours(1);

/// Sync follows the user's Dialpad connection in Macro Connect. Users connect,
/// check and disconnect it; webhooks and reconciliation do the rest.
#[async_trait]
pub trait SyncService: Send + Sync {
    async fn status(&self, user: &MacroUserIdStr<'static>) -> Result<SyncStatus>;
    /// Start connecting: returns the Macro Connect URL to send the user to.
    async fn connect(&self, user: &MacroUserIdStr<'static>, backfill: Backfill) -> Result<String>;
    /// The user is back from Macro Connect: set up now instead of waiting for
    /// the next reconcile pass.
    async fn complete(&self, user: &MacroUserIdStr<'static>) -> Result<SyncStatus>;
    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()>;
    async fn receive(&self, id: Uuid, body: &[u8]) -> std::result::Result<(), SyncError>;
    /// Import one queued delivery. Returns whether there was work.
    async fn tick(&self) -> Result<bool>;
    /// Set up new enrollments and import past calls a page at a time.
    async fn reconcile(&self) -> Result<()>;
}

pub struct Service<R, G, D, V> {
    pub repo: R,
    pub grants: G,
    pub dialpad: D,
    pub verifier: V,
    pub calls: Arc<dyn CallImportService>,
    /// Public harness origin that Dialpad delivers webhooks to.
    pub public_url: String,
    /// The Settings page Macro Connect returns the user to.
    pub return_url: String,
}

fn new_secret() -> SigningSecret {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    SigningSecret(URL_SAFE_NO_PAD.encode(bytes))
}

fn status_of(connection: Option<Connection>) -> SyncStatus {
    match connection {
        None => SyncStatus::NotConnected,
        Some(connection) if connection.enabled => SyncStatus::Connected {
            last_synced_at: connection.last_synced_at,
            issue: connection.last_error,
        },
        Some(Connection {
            last_error: Some(issue),
            ..
        }) => SyncStatus::Failed { issue },
        Some(_) => SyncStatus::Connecting,
    }
}

impl<R: SyncRepository, G: Grants, D: Dialpad, V: DeliveryVerifier> Service<R, G, D, V> {
    /// Dialpad only delivers to public HTTPS endpoints; local stacks without a
    /// tunnel never set up.
    fn delivers(&self) -> bool {
        self.public_url.starts_with("https://")
    }

    #[tracing::instrument(
        name = "dialpad.start_sync",
        skip_all,
        fields(connection_id = %connection.id, outcome),
        err(Display)
    )]
    async fn setup(&self, connection: Connection) -> Result<()> {
        let span = tracing::Span::current();
        let token = match self.grants.grant(&connection.user_id).await? {
            Grant::Active(token) => token,
            Grant::NotConnected => {
                if connection.enrolled_at < chrono::Utc::now() - ENROLLMENT_TTL {
                    self.repo.delete(connection.id).await?;
                    span.record("outcome", "abandoned");
                } else {
                    span.record("outcome", "waiting");
                }
                return Ok(());
            }
            Grant::NeedsReauth => {
                self.repo
                    .stop(connection.id, SyncIssue::NeedsReauth)
                    .await?;
                span.record("outcome", "needs_reauth");
                return Ok(());
            }
        };
        let secret = new_secret();
        if !self.repo.begin_setup(connection.id, &secret).await? {
            span.record("outcome", "leased");
            return Ok(());
        }
        let result = self.register(&connection, &token, &secret).await;
        if result.is_err() {
            self.repo
                .stop(connection.id, SyncIssue::SetupFailed)
                .await?;
        }
        span.record("outcome", if result.is_ok() { "started" } else { "failed" });
        result
    }

    async fn register(
        &self,
        connection: &Connection,
        token: &AccessToken,
        secret: &SigningSecret,
    ) -> Result<()> {
        // Left behind when a sync stopped without a usable token.
        if let Some(old) = connection.registration
            && let Err(error) = self.dialpad.unregister(token, old).await
        {
            tracing::warn!(error = ?error, "could not remove old Dialpad subscription");
        }
        let me = self.dialpad.me(token).await?;
        let url = format!(
            "{}/integrations/dialpad/webhooks/{}",
            self.public_url.trim_end_matches('/'),
            connection.id
        );
        let webhook = self.dialpad.create_webhook(token, &url, secret).await?;
        let subscription_id = match self.dialpad.subscribe(token, webhook, me.id).await {
            Ok(id) => id,
            Err(error) => {
                if let Err(cleanup) = self.dialpad.delete_webhook(token, webhook).await {
                    tracing::warn!(error = ?cleanup, "could not remove unused Dialpad webhook");
                }
                return Err(error);
            }
        };
        let registration = Registration {
            webhook_id: webhook,
            subscription_id,
        };
        // A disconnect or restart raced setup: retire what was just created.
        if !self
            .repo
            .activate(connection.id, me.id, registration)
            .await?
        {
            self.dialpad.unregister(token, registration).await?;
        }
        Ok(())
    }

    #[tracing::instrument(
        name = "dialpad.backfill_page",
        skip_all,
        fields(connection_id = %connection.id, calls),
        err(Display)
    )]
    async fn backfill_page(&self, connection: Connection) -> Result<()> {
        let BackfillState::Pending { since, cursor } = &connection.backfill else {
            return Ok(());
        };
        let Some(dialpad_user) = connection.dialpad_user_id else {
            return Ok(());
        };
        // Deliveries notice a lost grant and stop the sync.
        let Grant::Active(token) = self.grants.grant(&connection.user_id).await? else {
            return Ok(());
        };
        let page = self
            .dialpad
            .calls(&token, dialpad_user, *since, cursor.as_deref())
            .await?;
        let calls: Vec<CallEvent> = page
            .calls
            .into_iter()
            .filter(|call| call.date_connected.is_some() && call.occurred_at().is_some())
            .map(|call| CallEvent {
                state: CallState::Backfill,
                ..call
            })
            .collect();
        tracing::Span::current().record("calls", calls.len());
        self.repo
            .advance_backfill(connection.id, calls, page.cursor)
            .await
    }

    async fn sync_call(&self, job: &Job) -> Result<()> {
        let span = tracing::Span::current();
        let events = self.repo.events(job.connection.id, job.call_id).await?;
        let Some(needs) = mapping::needs(&events) else {
            span.record("outcome", "not_connected_call");
            return Ok(());
        };
        let token = match self.grants.grant(&job.connection.user_id).await? {
            Grant::Active(token) => token,
            Grant::NotConnected => {
                self.repo
                    .stop(job.connection.id, SyncIssue::Stopped)
                    .await?;
                span.record("outcome", "stopped");
                return Ok(());
            }
            Grant::NeedsReauth => {
                self.repo
                    .flag(job.connection.id, SyncIssue::NeedsReauth)
                    .await?;
                return Err(rootcause::report!("Dialpad needs reauthorization"));
            }
        };
        let transcript = if needs.transcript {
            self.dialpad
                .transcript(&token, job.call_id)
                .instrument(tracing::info_span!("dialpad.fetch_transcript"))
                .await?
        } else {
            None
        };
        let recap = if needs.recap {
            self.dialpad
                .recap(&token, job.call_id)
                .instrument(tracing::info_span!("dialpad.fetch_recap"))
                .await?
        } else {
            None
        };
        drop(token);
        let Some(call) = mapping::imported_call(&job.connection, &events, transcript, recap) else {
            return Ok(());
        };
        // A disconnect during the fetch must not import.
        let current = self.repo.by_id(job.connection.id).await?;
        if !current.is_some_and(|connection| connection.enabled) {
            span.record("outcome", "stopped");
            return Ok(());
        }
        let call_id = self
            .calls
            .ingest(call)
            .instrument(tracing::info_span!("dialpad.ingest"))
            .await?;
        span.record("imported", tracing::field::display(call_id));
        span.record("outcome", "imported");
        Ok(())
    }
}

#[async_trait]
impl<R: SyncRepository, G: Grants, D: Dialpad, V: DeliveryVerifier> SyncService
    for Service<R, G, D, V>
{
    async fn status(&self, user: &MacroUserIdStr<'static>) -> Result<SyncStatus> {
        Ok(status_of(self.repo.by_user(user).await?))
    }

    #[tracing::instrument(name = "dialpad.connect", skip_all, err(Display))]
    async fn connect(&self, user: &MacroUserIdStr<'static>, backfill: Backfill) -> Result<String> {
        let url = self.grants.connect_url(user, &self.return_url).await?;
        self.repo
            .enroll(user, backfill.since(chrono::Utc::now()))
            .await?;
        Ok(url)
    }

    #[tracing::instrument(name = "dialpad.complete_connect", skip_all, err(Display))]
    async fn complete(&self, user: &MacroUserIdStr<'static>) -> Result<SyncStatus> {
        let connection = self.repo.by_user(user).await?;
        if let Some(connection) = connection
            && self.delivers()
            && !connection.enabled
            && connection.last_error.is_none()
        {
            self.setup(connection).await?;
        }
        self.status(user).await
    }

    #[tracing::instrument(name = "dialpad.disconnect", skip_all, err(Display))]
    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        let connection = self.repo.by_user(user).await?;
        if let Some(registration) = connection.as_ref().and_then(|c| c.registration)
            && let Grant::Active(token) = self.grants.grant(user).await?
            && let Err(error) = self.dialpad.unregister(&token, registration).await
        {
            tracing::warn!(error = ?error, "could not remove Dialpad subscription");
        }
        self.grants.disconnect(user).await?;
        if let Some(connection) = connection {
            self.repo.delete(connection.id).await?;
        }
        Ok(())
    }

    #[tracing::instrument(
        name = "dialpad.receive_delivery",
        skip_all,
        fields(provider = "dialpad", connection_id = %id, call_id, state),
        err(Display)
    )]
    async fn receive(&self, id: Uuid, body: &[u8]) -> std::result::Result<(), SyncError> {
        let connection = self
            .repo
            .by_id(id)
            .await?
            .ok_or(SyncError::InvalidDelivery)?;
        let secret = connection
            .secret
            .as_ref()
            .ok_or(SyncError::InvalidDelivery)?;
        let event = self
            .verifier
            .verify(secret, body)
            .ok_or(SyncError::InvalidDelivery)?;
        let span = tracing::Span::current();
        span.record("call_id", tracing::field::display(event.call_id));
        span.record("state", event.state.as_ref());
        if !CallState::SUBSCRIBED.contains(&event.state) {
            return Ok(());
        }
        if event.occurred_at().is_none() {
            return Err(SyncError::InvalidDelivery);
        }
        let traceparent = macro_tower_layers::current_traceparent();
        self.repo.enqueue(id, event, traceparent).await?;
        Ok(())
    }

    async fn tick(&self) -> Result<bool> {
        let Some(job) = self.repo.claim().await? else {
            return Ok(false);
        };
        let span = tracing::info_span!(
            "dialpad.sync_call",
            provider = "dialpad",
            connection_id = %job.connection.id,
            call_id = %job.call_id,
            state = job.state.as_ref(),
            attempts = job.attempts,
            imported = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        if let Some(traceparent) = &job.traceparent {
            macro_tower_layers::adopt_traceparent(&span, traceparent);
        }
        let result = self.sync_call(&job).instrument(span.clone()).await;
        self.repo.finish(&job, result.is_ok()).await?;
        if let Err(error) = result {
            span.record("outcome", "retry");
            tracing::warn!(parent: &span, error = ?error, "Dialpad call sync will retry");
        }
        Ok(true)
    }

    #[tracing::instrument(name = "dialpad.reconcile", skip(self), err(Display))]
    async fn reconcile(&self) -> Result<()> {
        if !self.delivers() {
            return Ok(());
        }
        for connection in self.repo.awaiting_setup(RECONCILE_BATCH).await? {
            if let Err(error) = self.setup(connection).await {
                tracing::warn!(error = %error, "Dialpad sync setup failed; will retry");
            }
        }
        for connection in self.repo.backfilling(RECONCILE_BATCH).await? {
            if let Err(error) = self.backfill_page(connection).await {
                tracing::warn!(error = %error, "Dialpad backfill page failed; will retry");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
