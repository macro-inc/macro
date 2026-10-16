//! Opaque, short-lived copies for providers that fetch media by URL. Cleanup is
//! reserved before bytes leave Macro; native document ownership is never changed.

use super::{
    models::MessagingError,
    ports::{Lease, MediaBytes, PortResult},
};
use async_trait::async_trait;
use futures::{StreamExt, stream};
use std::sync::Arc;
use uuid::Uuid;

/// Lifetime of the signed URL, independently of physical object cleanup.
pub const MEDIA_URL_SECONDS: u64 = 15 * 60;
/// Existing email-bucket namespace, outside native document event consumers.
pub fn copy_key(id: Uuid) -> String {
    format!("temp/macro-messaging/{id}")
}

/// Durable cleanup capability for one copy.
pub struct MediaCopyWork {
    /// Unique object identity and current cleanup fence.
    pub lease: Lease,
    /// Bucket recorded before upload, retained across configuration changes.
    pub bucket: String,
}

/// Persistence owns cleanup claims; no provider or storage request runs in its transactions.
#[async_trait]
pub trait MediaCopyRepository: Send + Sync {
    /// Reserve a new opaque identity and cleanup at one day from database time.
    async fn reserve_copy(&self, bucket: &str) -> PortResult<Uuid>;
    /// Claim at most twenty expired copies for five minutes.
    async fn claim_copies(&self) -> PortResult<Vec<MediaCopyWork>>;
    /// Remove metadata only after physical deletion is verified; otherwise retry.
    async fn settle_copy(&self, lease: &Lease, deleted: bool) -> PortResult<()>;
}

/// Object storage has access only to isolated temporary copies.
#[async_trait]
pub trait MediaCopyStorage: Send + Sync {
    /// Upload to the opaque key and sign only that object. Implementations bound I/O to sixty seconds.
    async fn put_copy(&self, bucket: &str, id: Uuid, file: &MediaBytes) -> PortResult<String>;
    /// Delete actual object versions/markers and verify absence, bounded to thirty seconds.
    async fn remove_copy(&self, bucket: &str, id: Uuid) -> PortResult<bool>;
}

/// Content-free cleanup counters.
#[derive(Debug, Default)]
pub struct MediaCopyCleanup {
    /// Copies verified gone from storage and retired from the ledger.
    pub deleted: u32,
    /// Copies needing another bounded pass.
    pub deferred: u32,
    /// Attempts that failed and remain durable.
    pub failed: u32,
}

/// Capability supplied only after the native document access check.
#[async_trait]
pub trait TemporaryMedia: Send + Sync {
    /// Stage already-authorized native bytes without sharing the original document.
    async fn stage(&self, file: &MediaBytes) -> PortResult<String>;
    /// Retire expired copies without customer-content logging.
    async fn cleanup(&self) -> PortResult<MediaCopyCleanup>;
}

/// Reserve → upload → scoped URL; expired copies remain queued until deletion is verified.
pub struct TemporaryMediaService {
    repository: Arc<dyn MediaCopyRepository>,
    storage: Arc<dyn MediaCopyStorage>,
    bucket: String,
}
impl TemporaryMediaService {
    /// Validate the configured bucket at composition, without accepting a user-supplied destination.
    pub fn new(
        repository: Arc<dyn MediaCopyRepository>,
        storage: Arc<dyn MediaCopyStorage>,
        bucket: String,
    ) -> Result<Self, MessagingError> {
        if !(3..=63).contains(&bucket.len())
            || !bucket
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'.'))
        {
            return Err(MessagingError::Invalid(
                "temporary media bucket is not configured correctly",
            ));
        }
        Ok(Self {
            repository,
            storage,
            bucket,
        })
    }
}
#[async_trait]
impl TemporaryMedia for TemporaryMediaService {
    async fn stage(&self, file: &MediaBytes) -> PortResult<String> {
        let id = self.repository.reserve_copy(&self.bucket).await?;
        // A crash or failed response after the upload still leaves a cleanup row.
        self.storage.put_copy(&self.bucket, id, file).await
    }
    async fn cleanup(&self) -> PortResult<MediaCopyCleanup> {
        let mut work = stream::iter(self.repository.claim_copies().await?)
            .map(|work| async move {
                let removed = self.storage.remove_copy(&work.bucket, work.lease.id).await;
                let deleted = removed.as_ref().copied().unwrap_or(false);
                let settled = self.repository.settle_copy(&work.lease, deleted).await;
                (deleted, removed.is_err() || settled.is_err())
            })
            .buffer_unordered(4);
        let mut counts = MediaCopyCleanup::default();
        while let Some((deleted, failed)) = work.next().await {
            if failed {
                counts.failed += 1;
            } else if deleted {
                counts.deleted += 1;
            } else {
                counts.deferred += 1;
            }
        }
        Ok(counts)
    }
}
