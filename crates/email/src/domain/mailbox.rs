//! Durable mailbox enumeration independent from provider-specific notifications.

use email_api_client::domain::models::{
    EmailApiError, MailFolder, MailboxChangePage, MailboxMessage, ProviderId, StreamToken,
};
use std::future::Future;
use uuid::Uuid;

pub mod catalog;
pub mod commands;
pub mod contacts;
pub mod credentials;
pub mod drafts;
pub mod gmail_history;
pub mod health;
pub mod initialization;
pub mod lifecycle;
pub mod projection;
pub mod settings;
#[cfg(test)]
mod test;
pub mod watches;

#[derive(Debug, thiserror::Error)]
pub enum MailboxError {
    #[error("{0}")]
    InvalidInput(&'static str),
    #[error(transparent)]
    Provider(#[from] EmailApiError),
    #[error("mailbox persistence is unavailable")]
    Persistence,
    #[error("mailbox generation or worker lease changed")]
    Stale,
}

/// Both generations are resolved from storage, never selected by the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MailboxKey {
    pub link_id: Uuid,
    pub sync_generation: i64,
    pub grant_generation: i64,
}

#[derive(Debug)]
pub struct StreamLease {
    pub id: Uuid,
    pub mailbox: MailboxKey,
    pub folder: ProviderId,
    pub position: Option<StreamToken>,
    pub initial_complete: bool,
    pub lease_id: Uuid,
    pub fence: i64,
}

#[derive(Debug)]
pub struct MessageLease {
    pub mailbox: MailboxKey,
    pub provider_id: ProviderId,
    pub revision: i64,
    pub lease_id: Uuid,
    pub is_import: bool,
    pub attempts: i32,
}

#[derive(Debug)]
pub struct CatalogLease {
    pub id: Uuid,
    pub mailbox: MailboxKey,
    pub lease_id: Uuid,
    pub fence: i64,
}

pub enum SyncLease<'a> {
    Catalog(&'a CatalogLease),
    Stream(&'a StreamLease),
    Message(&'a MessageLease),
}

pub trait MailboxSyncRepository: Send + Sync + 'static {
    /// Extend only a still-current lease while a provider operation is in flight.
    fn renew(&self, lease: SyncLease<'_>) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_catalog(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<CatalogLease>, MailboxError>> + Send;
    /// Replaces a complete catalog only under its lease fence. Missing folders
    /// trigger message reconciliation, never deletion based on a partial scan.
    fn commit_catalog(
        &self,
        lease: &CatalogLease,
        folders: &[MailFolder],
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_catalog(
        &self,
        lease: &CatalogLease,
        retry_after_seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_stream(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<StreamLease>, MailboxError>> + Send;
    /// Atomically records every changed/removed ID and advances the opaque
    /// cursor only while this generation and lease fence are still current.
    fn commit_page(
        &self,
        lease: &StreamLease,
        page: &MailboxChangePage,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Reset only this expired stream; this operation never removes messages.
    fn reset_stream(
        &self,
        lease: &StreamLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_stream(
        &self,
        lease: &StreamLease,
        retry_after_seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_message(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<MessageLease>, MailboxError>> + Send;
    fn folders(
        &self,
        mailbox: MailboxKey,
    ) -> impl Future<Output = Result<Vec<MailFolder>, MailboxError>> + Send;
    /// Finishes only the leased revision. A newer wakeup must remain pending.
    fn complete_message(
        &self,
        lease: &MessageLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_message(
        &self,
        lease: &MessageLease,
        retry_after_seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

pub trait MailboxGateway: Send + Sync + 'static {
    fn folders(
        &self,
        mailbox: MailboxKey,
    ) -> impl Future<Output = Result<Vec<MailFolder>, EmailApiError>> + Send;
    fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> impl Future<Output = Result<MailboxChangePage, EmailApiError>> + Send;
    fn message(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        folders: &[MailFolder],
    ) -> impl Future<Output = Result<Option<MailboxMessage>, EmailApiError>> + Send;
}

/// The shared ingestion path writes content, normalized state and a projection
/// outbox atomically. Import work must not generate incoming-mail notifications.
pub trait MailboxIngest: Send + Sync + 'static {
    fn ingest(
        &self,
        lease: &MessageLease,
        snapshot: MailboxMessage,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// A mailbox-wide GET returned 404. Preserve recoverable content, reconcile
    /// membership, and recheck before any destructive retention decision.
    fn absent(&self, lease: &MessageLease)
    -> impl Future<Output = Result<(), MailboxError>> + Send;
}

pub struct MailboxSyncService<R, P, I> {
    repo: R,
    provider: P,
    ingest: I,
}

impl<R, P, I> MailboxSyncService<R, P, I> {
    pub fn new(repo: R, provider: P, ingest: I) -> Self {
        Self {
            repo,
            provider,
            ingest,
        }
    }
}

impl<R: MailboxSyncRepository, P: MailboxGateway, I: MailboxIngest> MailboxSyncService<R, P, I> {
    pub async fn discover_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_catalog(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let outcome = maintain_lease(
            async { Ok(self.provider.folders(lease.mailbox).await?) },
            || self.repo.renew(SyncLease::Catalog(&lease)),
        )
        .await;
        match outcome {
            Ok(folders) => self.repo.commit_catalog(&lease, &folders).await?,
            Err(MailboxError::Provider(error)) => {
                self.repo
                    .release_catalog(&lease, retry_seconds(&error))
                    .await?;
                return Err(error.into());
            }
            Err(error) => return Err(error),
        }
        Ok(true)
    }
    /// Process one bounded provider page. Notifications only make streams due;
    /// periodic polling recovers missed, duplicate and out-of-order notifications.
    pub async fn enumerate_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_stream(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let outcome = maintain_lease(
            async {
                Ok(self
                    .provider
                    .changes(lease.mailbox, &lease.folder, lease.position.as_ref())
                    .await?)
            },
            || self.repo.renew(SyncLease::Stream(&lease)),
        )
        .await;
        match outcome {
            Ok(page) => self.repo.commit_page(&lease, &page).await?,
            Err(MailboxError::Provider(EmailApiError::OutdatedCursor)) => {
                self.repo.reset_stream(&lease).await?
            }
            Err(MailboxError::Provider(error)) => {
                self.repo
                    .release_stream(&lease, retry_seconds(&error))
                    .await?;
                return Err(error.into());
            }
            Err(error) => return Err(error),
        }
        Ok(true)
    }

    pub async fn reconcile_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_message(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let operation = async {
            let folders = self.repo.folders(lease.mailbox).await?;
            match self
                .provider
                .message(lease.mailbox, &lease.provider_id, &folders)
                .await?
            {
                Some(snapshot) => self.ingest.ingest(&lease, snapshot).await?,
                None if lease.attempts < 3 => {
                    return Err(EmailApiError::Transient {
                        message: "mailbox message location has not settled".into(),
                    }
                    .into());
                }
                None => self.ingest.absent(&lease).await?,
            }
            self.repo.complete_message(&lease).await
        };
        let result =
            maintain_lease(operation, || self.repo.renew(SyncLease::Message(&lease))).await;
        if let Err(error) = &result {
            let delay = match error {
                MailboxError::Provider(error) => retry_seconds(error),
                _ => 30,
            };
            self.repo.release_message(&lease, delay).await?;
        }
        result.map(|()| true)
    }
}

/// Keep long catalogue scans and uploads fenced without imposing an arbitrary
/// mailbox-size limit. Losing ownership cancels the operation, never its successor.
pub(crate) async fn maintain_lease<F, H, HF, T>(
    operation: F,
    mut renew: H,
) -> Result<T, MailboxError>
where
    F: Future<Output = Result<T, MailboxError>>,
    H: FnMut() -> HF,
    HF: Future<Output = Result<(), MailboxError>>,
{
    tokio::pin!(operation);
    loop {
        tokio::select! {
            result = &mut operation => return result,
            _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => renew().await?,
        }
    }
}

fn retry_seconds(error: &EmailApiError) -> u32 {
    match error {
        EmailApiError::RateLimited {
            retry_after: Some(delay),
            ..
        } => delay.as_secs().clamp(1, 86_400) as u32,
        EmailApiError::AuthRequired | EmailApiError::Forbidden => 300,
        EmailApiError::Permanent { .. } => 600,
        _ => 30,
    }
}
