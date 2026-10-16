use super::{models::*, ports::*};
use async_trait::async_trait;
use call::domain::imports::CallImportService;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use tracing::Instrument;
use uuid::Uuid;

/// Scopes tried in order; Granola accepts exactly one of these per key type.
const SCOPE_PREFERENCE: [Scope; 2] = [Scope::All, Scope::Workspace];
/// Reconcile work per pass, so one pass never monopolizes the worker.
const RECONCILE_BATCH: usize = 20;
/// Failed setups (no Business plan, revoked key) retry at this interval.
const SETUP_RETRY: chrono::Duration = chrono::Duration::hours(1);
/// Matches the reservation window in which another instance owns setup.
const SETUP_LEASE: chrono::Duration = chrono::Duration::minutes(2);

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Plan {
    pub stop: Vec<Uuid>,
    pub start: Vec<MacroUserIdStr<'static>>,
}

/// Every enabled Granola account should have one active webhook at the widest
/// scope; syncs whose account went away are stopped.
pub(crate) fn plan(
    accounts: &[(MacroUserIdStr<'static>, String)],
    states: &[SyncState],
    now: chrono::DateTime<chrono::Utc>,
) -> Plan {
    let account = |user: &MacroUserIdStr<'static>| {
        accounts
            .iter()
            .find(|(u, _)| u == user)
            .map(|(_, a)| a.as_str())
    };
    let mut plan = Plan::default();
    for state in states {
        if state.enabled && account(&state.user_id) != Some(state.account_id.as_str()) {
            plan.stop.push(state.id);
        }
    }
    for (user, account_id) in accounts {
        let Some(state) = states.iter().find(|s| &s.user_id == user) else {
            plan.start.push(user.clone());
            continue;
        };
        let due = if state.account_id != *account_id {
            true
        } else if state.enabled {
            !SCOPE_PREFERENCE.contains(&state.scope)
        } else {
            match state.last_error.as_deref() {
                Some(STOPPED) => true,
                Some(_) => state.started_at < now - SETUP_RETRY,
                // A reservation that never finished; its owner likely exited.
                None => !state.has_endpoint && state.started_at < now - SETUP_LEASE,
            }
        };
        if due {
            plan.start.push(user.clone());
        }
    }
    plan
}

/// Sync follows the user's Granola connection; there are no user controls.
/// Webhook ingestion and reconciliation are the only entry points.
#[async_trait]
pub trait SyncService: Send + Sync {
    async fn receive(&self, id: Uuid, delivery: Delivery<'_>)
    -> std::result::Result<(), SyncError>;
    /// Process one queued delivery. Returns whether there was work.
    async fn tick(&self) -> Result<bool>;
    /// Start sync for newly connected accounts and stop it for removed ones.
    async fn reconcile(&self) -> Result<()>;
}

pub struct Service<R, G, A, V> {
    pub repo: R,
    pub granola: G,
    pub accounts: A,
    pub verifier: V,
    pub calls: Arc<dyn CallImportService>,
    /// Public DCS origin, supplied by the composition root's existing config.
    pub public_url: String,
}

impl<R: SyncRepository, G: Granola, A: Accounts, V: DeliveryVerifier> Service<R, G, A, V> {
    async fn is_current(&self, connection: &Connection) -> Result<bool> {
        Ok(connection.enabled
            && self.accounts.account(&connection.user_id).await?.as_deref()
                == Some(connection.account_id.as_str()))
    }

    #[tracing::instrument(name = "granola.start_sync", skip_all, fields(scope), err(Display))]
    async fn start(&self, user: MacroUserIdStr<'static>) -> std::result::Result<(), SyncError> {
        let Some(account) = self.accounts.account(&user).await? else {
            return Ok(());
        };
        let old = self.repo.by_user(&user).await?;
        let connection = Connection {
            id: macro_uuid::generate_uuid_v7(),
            user_id: user,
            account_id: account,
            namespace: old
                .as_ref()
                .map(|c| c.namespace)
                .unwrap_or_else(macro_uuid::generate_uuid_v7),
            scope: SCOPE_PREFERENCE[0],
            enabled: false,
            endpoint_id: None,
            secret: None,
            started_at: chrono::Utc::now(),
            last_synced_at: None,
            last_error: None,
        };
        if !self.repo.reserve(&connection).await? {
            return Err(SyncError::Conflict);
        }
        // Old deliveries stop being accepted once the new connection ID is saved.
        if let Some(old) = &old
            && let Err(error) = self.granola.unregister(old).await
        {
            tracing::warn!(error = ?error, "could not remove old Granola endpoint");
        }
        let url = format!(
            "{}/integrations/granola/webhooks/{}",
            self.public_url.trim_end_matches('/'),
            connection.id
        );
        let mut registered = None;
        for scope in SCOPE_PREFERENCE {
            match self.granola.register(&connection, &url, scope).await {
                Ok(Registration::Registered(webhook)) => {
                    registered = Some((webhook, scope));
                    break;
                }
                Ok(Registration::ScopeRejected) => continue,
                Err(error) => {
                    self.repo.failed_setup(connection.id).await?;
                    return Err(SyncError::Internal(error));
                }
            }
        }
        let Some((webhook, scope)) = registered else {
            self.repo.failed_setup(connection.id).await?;
            return Err(SyncError::Internal(rootcause::report!(
                "Granola rejected every webhook scope for this key"
            )));
        };
        // If a disconnect or another instance raced registration, retire the endpoint.
        let cleanup = Connection {
            endpoint_id: Some(webhook.id.clone()),
            ..connection.clone()
        };
        if !self.repo.activate(connection.id, webhook, scope).await? {
            self.granola.unregister(&cleanup).await?;
            return Err(SyncError::Conflict);
        }
        tracing::Span::current().record("scope", scope.as_str());
        tracing::info!("Granola meeting sync started");
        Ok(())
    }

    async fn stop(&self, id: Uuid) -> Result<()> {
        let Some(connection) = self.repo.by_id(id).await? else {
            return Ok(());
        };
        self.repo.stop(connection.id).await?;
        // A removed Pipedream account can no longer authenticate this call; the
        // endpoint then fails deliveries until Granola disables it.
        if let Err(error) = self.granola.unregister(&connection).await {
            tracing::warn!(error = ?error, "could not remove disabled Granola endpoint");
        }
        Ok(())
    }
}

#[async_trait]
impl<R: SyncRepository, G: Granola, A: Accounts, V: DeliveryVerifier> SyncService
    for Service<R, G, A, V>
{
    async fn receive(
        &self,
        id: Uuid,
        delivery: Delivery<'_>,
    ) -> std::result::Result<(), SyncError> {
        let connection = self
            .repo
            .by_id(id)
            .await?
            .ok_or(SyncError::InvalidDelivery)?;
        // Granola discards 401 deliveries permanently; setup races must retry.
        let secret = connection.secret.as_ref().ok_or_else(|| {
            if connection.last_error.is_none() {
                SyncError::Unavailable
            } else {
                SyncError::InvalidDelivery
            }
        })?;
        if !self.verifier.verify(secret, &delivery) {
            return Err(SyncError::InvalidDelivery);
        }
        let event: Event =
            serde_json::from_slice(delivery.body).map_err(|_| SyncError::InvalidDelivery)?;
        if event.event_id.to_string() != delivery.id {
            return Err(SyncError::InvalidDelivery);
        }
        if self.is_current(&connection).await? {
            self.repo.enqueue(id, event).await?;
        }
        Ok(())
    }

    async fn tick(&self) -> Result<bool> {
        let Some(job) = self.repo.claim().await? else {
            return Ok(false);
        };
        let span = tracing::info_span!(
            "granola.sync_meeting",
            connection_id = %job.connection.id,
            event_id = %job.event.event_id,
            event_type = job.event.event_type.as_str(),
            attempts = job.attempts,
            imported = tracing::field::Empty,
        );
        let result = async {
            if !self.is_current(&job.connection).await? {
                return Ok(());
            }
            let Some(meeting) = self
                .granola
                .meeting(&job.connection, &job.event.note_id)
                .await?
            else {
                return Ok(());
            };
            let current = self.repo.by_id(job.connection.id).await?;
            if let Some(current) = current
                && self.is_current(&current).await?
            {
                let call_id = self.calls.ingest(meeting).await?;
                tracing::Span::current().record("imported", tracing::field::display(call_id));
            }
            Ok::<(), rootcause::Report>(())
        }
        .instrument(span)
        .await;
        self.repo.finish(&job, result.is_ok()).await?;
        if let Err(error) = result {
            tracing::warn!(error = ?error, event_id = %job.event.event_id, "Granola meeting sync will retry");
        }
        Ok(true)
    }

    #[tracing::instrument(
        name = "granola.reconcile",
        skip(self),
        fields(stopped, started),
        err(Debug)
    )]
    async fn reconcile(&self) -> Result<()> {
        // Granola only delivers to public HTTPS endpoints.
        if !self.public_url.starts_with("https://") {
            return Ok(());
        }
        let accounts = self.accounts.connected().await?;
        let states = self.repo.states().await?;
        let plan = plan(&accounts, &states, chrono::Utc::now());
        let span = tracing::Span::current();
        span.record("stopped", plan.stop.len().min(RECONCILE_BATCH));
        span.record("started", plan.start.len().min(RECONCILE_BATCH));
        for id in plan.stop.into_iter().take(RECONCILE_BATCH) {
            self.stop(id).await?;
        }
        for user in plan.start.into_iter().take(RECONCILE_BATCH) {
            match self.start(user).await {
                // Another instance is setting this user up.
                Ok(()) | Err(SyncError::Conflict) => {}
                Err(error) => {
                    tracing::warn!(error = %error, "Granola meeting sync setup failed; will retry")
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
