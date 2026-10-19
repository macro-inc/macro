//! Draft identities, editable content, and resumable attachment transfer.

use super::{ProviderId, SendRequest};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A draft created for one stable Macro message, with a searchable correlation ID.
#[derive(Debug, Clone)]
pub struct DraftRequest {
    /// Stable Macro message identity, scoped by the mailbox credential.
    pub correlation: Uuid,
    /// Monotonic local revision, stamped atomically with editable content.
    pub revision: u64,
    /// Parent in the same mailbox, when a native provider reply is available.
    pub reply_to: Option<ProviderId>,
    /// Prepared content and RFC reply metadata. Attachments are uploaded separately.
    pub content: SendRequest,
}

/// Provider metadata needed to bind and protect a local draft shadow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDraft {
    /// Immutable mailbox-scoped message identity.
    pub id: ProviderId,
    /// Provider conversation identity.
    pub conversation_id: ProviderId,
    /// Opaque concurrency token; absence forbids an overwrite.
    pub version: Option<String>,
    /// False means another client submitted the draft.
    pub is_draft: bool,
    /// Last Macro content revision observed on the provider, if any.
    pub app_revision: Option<u64>,
    /// Digest of provider-normalized content, excluding mutable attachment metadata.
    /// A missing digest forbids advancing through an attachment edit to delivery.
    #[serde(default)]
    pub content_fingerprint: Option<String>,
}

/// Attachment identity supplied by the provider and the app's stable content ID.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftAttachment {
    /// Provider attachment identity.
    pub id: ProviderId,
    /// Filename.
    pub name: String,
    /// Decoded byte length.
    pub size: u64,
    /// Content-ID retained for reconciliation and inline rendering.
    pub content_id: Option<String>,
    /// Whether the attachment is displayed inline.
    pub inline: bool,
}

/// Metadata and content for one attachment with a durable client identity.
#[derive(Clone, Copy)]
pub struct AttachmentContent<'a> {
    /// User-visible file name.
    pub name: &'a str,
    /// MIME content type.
    pub content_type: &'a str,
    /// Stable Content-ID, including for non-inline uploads.
    pub content_id: &'a str,
    /// Whether the message body references this attachment.
    pub inline: bool,
    /// Raw file contents.
    pub data: &'a [u8],
}

/// A preauthorized upload URL. Never log this bearer credential.
#[derive(Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UploadUrl(String);
impl UploadUrl {
    /// Retain a URL; outbound adapters must validate origin and scheme before use.
    pub fn new(value: String) -> Self {
        Self(value)
    }
    /// Expose only to persistence or an outbound request.
    pub fn expose(&self) -> &str {
        &self.0
    }
}
impl std::fmt::Debug for UploadUrl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UploadUrl([REDACTED])")
    }
}

/// Provider-confirmed upload checkpoint; offsets are read after uncertain PUTs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentUploadSession {
    /// Preauthorized URL; requests to it never carry an OAuth bearer header.
    pub url: UploadUrl,
    /// Provider expiry.
    pub expires_at: DateTime<Utc>,
    /// First byte still required by the server.
    pub next_offset: u64,
}

/// One upload response, distinguishing accepted ranges from a completed attachment.
#[derive(Debug, Clone)]
pub enum UploadProgress {
    /// Continue from this provider checkpoint.
    Continue(AttachmentUploadSession),
    /// Upload completed; list attachments to resolve its stable Content-ID.
    Complete,
}
