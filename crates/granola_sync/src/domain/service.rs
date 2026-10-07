use super::{models::*, ports::*};
use async_trait::async_trait;
use call::domain::imports::{CallImportService, ImportedCallPreview};
use call::domain::records::CallEntityRecord;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use uuid::Uuid;

/// User actions and webhook ingestion; transport layers do not decide policy.
#[async_trait]
pub trait SyncService: Send + Sync {
    async fn status(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> std::result::Result<SyncStatus, SyncError>;
    async fn start(
        &self,
        user: MacroUserIdStr<'static>,
        scope: Scope,
    ) -> std::result::Result<(), SyncError>;
    async fn stop(&self, user: MacroUserIdStr<'static>) -> std::result::Result<(), SyncError>;
    async fn receive(&self, id: Uuid, delivery: Delivery<'_>)
    -> std::result::Result<(), SyncError>;
    async fn tick(&self) -> Result<bool>;
    async fn meetings(&self, user: MacroUserIdStr<'static>) -> Result<Vec<ImportedCallPreview>>;
    async fn meeting(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>>;
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
}

#[async_trait]
impl<R: SyncRepository, G: Granola, A: Accounts, V: DeliveryVerifier> SyncService
    for Service<R, G, A, V>
{
    async fn status(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> std::result::Result<SyncStatus, SyncError> {
        let account = self.accounts.account(&user).await?;
        let connection = self.repo.by_user(&user).await?;
        let current = connection
            .as_ref()
            .filter(|c| Some(c.account_id.as_str()) == account.as_deref());
        Ok(SyncStatus {
            connected: account.is_some(),
            enabled: current.is_some_and(|c| c.enabled),
            scope: current.map(|c| c.scope),
            started_at: current.map(|c| c.started_at),
            last_synced_at: current.and_then(|c| c.last_synced_at),
            last_error: current.and_then(|c| c.last_error.clone()),
        })
    }

    async fn start(
        &self,
        user: MacroUserIdStr<'static>,
        scope: Scope,
    ) -> std::result::Result<(), SyncError> {
        if !self.public_url.starts_with("https://") {
            return Err(SyncError::Unavailable);
        }
        let account = self
            .accounts
            .account(&user)
            .await?
            .ok_or(SyncError::NotConnected)?;
        let old = self.repo.by_user(&user).await?;
        if let Some(old) = &old {
            if old.enabled && old.account_id == account && old.scope == scope {
                return Ok(());
            }
            if old.endpoint_id.is_none()
                && old.last_error.is_none()
                && old.started_at > chrono::Utc::now() - chrono::Duration::minutes(2)
            {
                return Err(SyncError::Conflict);
            }
        }
        let connection = Connection {
            id: macro_uuid::generate_uuid_v7(),
            user_id: user,
            account_id: account,
            namespace: old
                .as_ref()
                .map(|c| c.namespace)
                .unwrap_or_else(macro_uuid::generate_uuid_v7),
            scope,
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
        let webhook = match self.granola.register(&connection, &url).await {
            Ok(webhook) => webhook,
            Err(error) => {
                self.repo.failed_setup(connection.id).await?;
                return Err(SyncError::Internal(error));
            }
        };
        // If stop/reconnect raced registration, retire the just-created endpoint.
        let cleanup = Connection {
            endpoint_id: Some(webhook.id.clone()),
            ..connection.clone()
        };
        if !self.repo.activate(connection.id, webhook).await? {
            self.granola.unregister(&cleanup).await?;
            return Err(SyncError::Conflict);
        }
        Ok(())
    }

    async fn stop(&self, user: MacroUserIdStr<'static>) -> std::result::Result<(), SyncError> {
        if let Some(connection) = self.repo.by_user(&user).await? {
            self.repo.stop(connection.id).await?;
            if let Err(error) = self.granola.unregister(&connection).await {
                tracing::warn!(error = ?error, "could not remove disabled Granola endpoint");
            }
        }
        Ok(())
    }

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
                self.calls.ingest(meeting).await?;
            }
            Ok::<(), rootcause::Report>(())
        }
        .await;
        self.repo.finish(&job, result.is_ok()).await?;
        if let Err(error) = result {
            tracing::warn!(error = ?error, event_id = %job.event.event_id, "Granola meeting sync will retry");
        }
        Ok(true)
    }

    async fn meetings(&self, user: MacroUserIdStr<'static>) -> Result<Vec<ImportedCallPreview>> {
        self.calls.list(&user).await
    }
    async fn meeting(
        &self,
        user: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<CallEntityRecord>> {
        self.calls.read(&user, id).await
    }
}
