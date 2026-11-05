use super::{mapping, models::*, ports::*};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use call::domain::imports::CallImportService;
use macro_user_id::user_id::MacroUserIdStr;
use rand::RngCore;
use serde::Deserialize;
use std::sync::Arc;
use tracing::Instrument;
use uuid::Uuid;

/// Reconcile work per pass, so one pass never monopolizes the worker.
const RECONCILE_BATCH: i64 = 20;
/// An enrollment the user never finished in Macro Connect is dropped after this.
const ENROLLMENT_TTL: chrono::Duration = chrono::Duration::hours(1);
/// A failing call retries with backoff, about three hours in all, then waits
/// for a new event from Dialpad.
pub(crate) const MAX_CALL_ATTEMPTS: i32 = 12;
/// Failed setup retries hourly for about a day, then waits for the user to
/// reconnect. Every failure counts the same: Dialpad's errors (its
/// subscription cap among them) are not told apart.
pub(crate) const MAX_SETUP_ATTEMPTS: i32 = 24;

/// Sync follows the user's Dialpad connection in Macro Connect. Users connect,
/// check and disconnect it; webhooks and reconciliation do the rest.
#[async_trait]
pub trait SyncService: Send + Sync {
    /// Where the user's sync stands.
    async fn status(&self, user: &MacroUserIdStr<'static>) -> Result<SyncStatus>;
    /// Start connecting: returns the Macro Connect URL to send the user to.
    async fn connect(&self, user: &MacroUserIdStr<'static>, backfill: Backfill) -> Result<String>;
    /// The user is back from Macro Connect: set up now instead of waiting for
    /// the next reconcile pass.
    async fn complete(&self, user: &MacroUserIdStr<'static>) -> Result<SyncStatus>;
    /// Stop syncing and remove the Dialpad connection from Macro Connect. Imported calls stay.
    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()>;
    /// Verify and store one webhook delivery. Only an unknown connection or
    /// a bad signature is refused.
    async fn receive(&self, id: Uuid, body: &[u8]) -> std::result::Result<(), SyncError>;
    /// Import one queued delivery. Returns whether there was work.
    async fn tick(&self) -> Result<bool>;
    /// Set up new enrollments and import past calls a page at a time.
    async fn reconcile(&self) -> Result<()>;
}

/// [`SyncService`] over its ports.
pub struct Service<R, G, D, V> {
    /// Sync state and deliveries.
    pub repo: R,
    /// The user's grant in Macro Connect.
    pub grants: G,
    /// Dialpad's REST API.
    pub dialpad: D,
    /// Delivery signature checks.
    pub verifier: V,
    /// Where calls are imported.
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

/// The subscription targets the connected Dialpad user, but an import makes
/// that user the call's owner, so anything else is dropped rather than
/// trusted. Logs ids only.
fn drop_unowned(connection_id: Uuid, event: &CallEvent) {
    tracing::warn!(
        connection_id = %connection_id,
        call_id = %event.call_id,
        state = event.state.as_ref(),
        "dropped a Dialpad event that is not the connected user's call"
    );
}

fn status_of(connection: Option<Connection>) -> SyncStatus {
    match connection {
        None
        | Some(Connection {
            last_error: Some(SyncIssue::Disconnected),
            ..
        }) => SyncStatus::NotConnected,
        Some(connection) if connection.enabled => SyncStatus::Connected {
            last_synced_at: connection.last_synced_at,
            // A reconnect prompt outranks import failures, and calls that
            // gave up outrank anything still retrying.
            issue: connection
                .last_error
                .or(match (connection.calls, &connection.backfill) {
                    (CallHealth::Abandoned, _) => Some(SyncIssue::CallsAbandoned),
                    (_, BackfillState::Pending { failures, .. }) if *failures > 0 => {
                        Some(SyncIssue::BackfillFailed)
                    }
                    (CallHealth::Retrying, _) => Some(SyncIssue::CallSyncFailed),
                    (CallHealth::Healthy, _) => None,
                }),
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
                    self.repo.stop(&connection, SyncIssue::Disconnected).await?;
                    span.record("outcome", "abandoned");
                } else {
                    span.record("outcome", "waiting");
                }
                return Ok(());
            }
            Grant::NeedsReauth => {
                self.repo.stop(&connection, SyncIssue::NeedsReauth).await?;
                span.record("outcome", "needs_reauth");
                return Ok(());
            }
        };
        let secret = new_secret();
        let Some(lease) = self.repo.begin_setup(&connection, &secret).await? else {
            span.record("outcome", "leased");
            return Ok(());
        };
        let result = self.register(&connection, lease, &token, &secret).await;
        if result.is_err() {
            let _ = self
                .repo
                .failed_setup(connection.id, lease, MAX_SETUP_ATTEMPTS)
                .await
                .inspect_err(
                    |error| tracing::warn!(error = ?error, "could not record failed Dialpad setup"),
                );
        }
        span.record("outcome", if result.is_ok() { "started" } else { "failed" });
        result
    }

    async fn register(
        &self,
        connection: &Connection,
        lease: SetupLease,
        token: &AccessToken,
        secret: &SigningSecret,
    ) -> Result<()> {
        // Left behind when a sync stopped without a usable token. Until they
        // are removed, setup fails and keeps their ids to retry, so a new
        // registration never leaves the old one subscribed. Already gone
        // counts as removed.
        if let Some(old) = connection.registration {
            self.dialpad.unregister(token, old).await?;
        }
        let me = self.dialpad.me(token).await?;
        let url = format!(
            "{}/integrations/dialpad/webhooks/{}",
            self.public_url.trim_end_matches('/'),
            connection.id
        );
        let webhook = self.dialpad.create_webhook(token, &url, secret).await?;
        let subscription_id = match self.dialpad.subscribe(token, webhook, me).await {
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
        // Retire resources whenever activation did not record their ownership.
        match self
            .repo
            .activate(connection.id, lease, me, registration)
            .await
        {
            Ok(true) => Ok(()),
            Ok(false) => self.dialpad.unregister(token, registration).await,
            Err(error) => {
                let _ = self.dialpad.unregister(token, registration).await.inspect_err(
                    |cleanup| tracing::warn!(error = ?cleanup, "could not remove unactivated Dialpad registration"),
                );
                Err(error)
            }
        }
    }

    #[tracing::instrument(
        name = "dialpad.backfill_page",
        skip_all,
        fields(connection_id = %connection.id, calls),
        err(Display)
    )]
    async fn backfill_page(&self, connection: Connection) -> Result<()> {
        let BackfillState::Pending { since, cursor, .. } = &connection.backfill else {
            return Ok(());
        };
        let Some(dialpad_user) = connection.dialpad_user_id else {
            return Ok(());
        };
        let token = match self.grants.grant(&connection.user_id).await? {
            Grant::Active(token) => token,
            Grant::NotConnected => {
                self.repo.stop(&connection, SyncIssue::Stopped).await?;
                return Ok(());
            }
            Grant::NeedsReauth => {
                self.repo.flag(&connection, SyncIssue::NeedsReauth).await?;
                // Keep checking the grant, behind backfills that can run.
                self.repo.defer_backfill(&connection).await?;
                return Ok(());
            }
        };
        let page = self
            .dialpad
            .calls(&token, dialpad_user, *since, cursor.as_deref())
            .await?;
        let (calls, unowned): (Vec<CallEvent>, Vec<CallEvent>) = page
            .calls
            .into_iter()
            .partition(|call| call.target_id() == Some(dialpad_user));
        for call in &unowned {
            drop_unowned(connection.id, call);
        }
        let calls: Vec<CallEvent> = calls
            .into_iter()
            .filter(|call| call.date_connected.is_some() && call.occurred_at().is_some())
            .map(|call| CallEvent {
                state: CallState::Backfill,
                ..call
            })
            .collect();
        tracing::Span::current().record("calls", calls.len());
        self.repo
            .advance_backfill(&connection, calls, page.cursor)
            .await
    }

    async fn sync_call(&self, job: &Job) -> Result<()> {
        let span = tracing::Span::current();
        let events = self.repo.events(job.connection.id, job.call_id).await?;
        // A running sync always knows its Dialpad user.
        let owner = job.connection.dialpad_user_id;
        let (events, unowned): (Vec<CallEvent>, Vec<CallEvent>) = events
            .into_iter()
            .partition(|event| owner.is_some() && event.target_id() == owner);
        for event in &unowned {
            drop_unowned(job.connection.id, event);
        }
        if events.is_empty() {
            span.record("outcome", "not_the_users_call");
            return Ok(());
        }
        let Some(needs) = mapping::needs(&events) else {
            span.record("outcome", "not_connected_call");
            return Ok(());
        };
        let token = match self.grants.grant(&job.connection.user_id).await? {
            Grant::Active(token) => token,
            Grant::NotConnected => {
                self.repo.stop(&job.connection, SyncIssue::Stopped).await?;
                span.record("outcome", "stopped");
                return Ok(());
            }
            Grant::NeedsReauth => {
                self.repo
                    .flag(&job.connection, SyncIssue::NeedsReauth)
                    .await?;
                return Err(rootcause::report!("Dialpad needs reauthorization"));
            }
        };
        let (transcript, recap) = tokio::try_join!(
            async {
                if needs.transcript {
                    self.dialpad.transcript(&token, job.call_id).await
                } else {
                    Ok(None)
                }
            },
            async {
                if needs.recap {
                    self.dialpad.recap(&token, job.call_id).await
                } else {
                    Ok(None)
                }
            },
        )?;
        drop(token);
        let Some(call) = mapping::imported_call(&job.connection, &events, transcript, recap) else {
            return Ok(());
        };
        // A stop or disconnect during the fetch drops the job's deliveries,
        // so it must not import. A reconnect while running keeps them.
        if !self.repo.holds(job).await? {
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
        match connection {
            Some(connection)
                if self.delivers() && !connection.enabled && connection.last_error.is_none() =>
            {
                self.setup(connection).await?;
                self.status(user).await
            }
            connection => Ok(status_of(connection)),
        }
    }

    #[tracing::instrument(name = "dialpad.disconnect", skip_all, err(Display))]
    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        let connection = self.repo.by_user(user).await?;
        // Kept registrations are removed by the next setup.
        let mut unregistered = false;
        if let Some(registration) = connection.as_ref().and_then(|c| c.registration)
            && let Grant::Active(token) = self.grants.grant(user).await?
        {
            unregistered = self
                .dialpad
                .unregister(&token, registration)
                .await
                .inspect_err(
                    |error| tracing::warn!(error = ?error, "could not remove Dialpad subscription"),
                )
                .is_ok();
        }
        self.grants.disconnect(user).await?;
        if let Some(connection) = connection {
            self.repo.disconnect(&connection, unregistered).await?;
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
        let claims = self
            .verifier
            .verify(secret, body)
            .ok_or(SyncError::InvalidDelivery)?;
        // Read the ids first, so an event that fails to decode can still be
        // traced. A state Macro does not know is not logged.
        let call_id = claims
            .get("call_id")
            .and_then(|id| DialpadId::deserialize(id).ok());
        let state = claims
            .get("state")
            .and_then(serde_json::Value::as_str)
            .and_then(|state| state.parse::<CallState>().ok());
        let span = tracing::Span::current();
        if let Some(call_id) = call_id {
            span.record("call_id", tracing::field::display(call_id));
        }
        if let Some(state) = state {
            span.record("state", state.as_ref());
        }
        // Dialpad signed it, so refusing would only make it resend the same
        // payload: acknowledge it and store nothing. Logs ids and the field
        // path only, never content.
        let unreadable = |problem: &str| {
            tracing::error!(
                connection_id = %id,
                call_id = ?call_id.map(|id| id.0),
                state = ?state.map(|state| state.as_ref().to_owned()),
                problem,
                "dropped a signed Dialpad event that could not be read"
            );
        };
        let event = match CallEvent::decode(claims) {
            Ok(event) => event,
            Err(path) => {
                unreadable(&format!("unexpected value at {path}"));
                return Ok(());
            }
        };
        if !CallState::SUBSCRIBED.contains(&event.state) {
            return Ok(());
        }
        if event.occurred_at().is_none() {
            unreadable("no timestamp");
            return Ok(());
        }
        // Mid-setup the Dialpad user may not be read yet, so only a missing
        // target is dropped here; the import checks the owner again.
        let owner = connection.dialpad_user_id.filter(|_| connection.enabled);
        let target = event.target_id();
        if target.is_none() || owner.is_some_and(|owner| target != Some(owner)) {
            drop_unowned(id, &event);
            return Ok(());
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
            attempts = job.attempts,
            imported = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        if let Some(traceparent) = &job.traceparent {
            macro_tower_layers::adopt_traceparent(&span, traceparent);
        }
        let result = self.sync_call(&job).instrument(span.clone()).await;
        let outcome = match &result {
            Ok(()) => JobOutcome::Done,
            Err(_) if job.attempts >= MAX_CALL_ATTEMPTS => JobOutcome::GiveUp,
            Err(_) => JobOutcome::Retry,
        };
        self.repo.finish(&job, outcome).await?;
        if let Err(error) = result {
            let gave_up = outcome == JobOutcome::GiveUp;
            span.record("outcome", if gave_up { "gave_up" } else { "retry" });
            tracing::warn!(parent: &span, error = ?error, gave_up, "Dialpad call sync failed");
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
            if let Err(error) = self.backfill_page(connection.clone()).await {
                tracing::warn!(error = %error, "Dialpad backfill page failed; will retry");
                self.repo.backfill_failed(&connection).await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
