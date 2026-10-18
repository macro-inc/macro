//! Opaque copies for providers that fetch media by URL. Eventual expiration is
//! handled by the email bucket temp/ lifecycle; native document ownership never changes.

use super::ports::{MediaBytes, PortResult};
use async_trait::async_trait;
use uuid::Uuid;

/// Lifetime of the signed URL, independently of physical object cleanup.
pub const MEDIA_URL_SECONDS: u64 = 15 * 60;
/// Existing email-bucket namespace, outside native document event consumers.
pub fn copy_key(id: Uuid) -> String {
    format!("temp/macro-messaging/{id}")
}

/// Capability supplied only after the native document access check.
#[async_trait]
pub trait TemporaryMedia: Send + Sync {
    /// Stage already-authorized native bytes without sharing the original document.
    async fn stage(&self, file: &MediaBytes) -> PortResult<String>;
}
