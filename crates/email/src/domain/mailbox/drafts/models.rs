use super::super::MailboxKey;
use crate::domain::models::ResolvedDraftInput;
use chrono::{DateTime, Utc};
use email_api_client::domain::models::{
    AttachmentUploadSession, ProviderDraft, ProviderId, SendRequest,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A frozen attachment source, always resolved through authorized server records.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AttachmentSource {
    /// Immutable uploaded object. Deletion waits for all active draft references.
    Uploaded { key: String },
    /// A specific attachment on another authorized message.
    Provider {
        db_id: Uuid,
        link_id: Uuid,
        generation: i64,
        message_id: ProviderId,
        attachment_id: ProviderId,
    },
}

/// Metadata frozen before the first provider mutation. Content is verified on read.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftFile {
    pub source: AttachmentSource,
    pub name: String,
    pub content_type: String,
    pub content_id: String,
    pub inline: bool,
    pub size: u64,
    pub sha256: String,
}

/// One immutable content revision, with no attachment bytes in the checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedDraft {
    #[serde(default)]
    pub reply_to: Option<ProviderId>,
    pub request: SendRequest,
    pub files: Vec<DraftFile>,
    /// Frozen explicit removals; unrelated attachments from Outlook are preserved.
    pub removals: Vec<crate::domain::models::draft_attachment_manifest::AttachmentRemoval>,
}

pub use crate::domain::models::mailbox_operation::DraftStage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transfer {
    pub index: usize,
    pub started_at: DateTime<Utc>,
    pub session: Option<AttachmentUploadSession>,
}

/// Every non-idempotent operation records its stage before calling the provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftCheckpoint {
    pub revision: i64,
    pub actor_id: String,
    pub prepared: PreparedDraft,
    pub stage: DraftStage,
    pub stage_started_at: DateTime<Utc>,
    /// True only after Macro atomically claims a requested delivery.
    #[serde(default)]
    pub submission_started: bool,
    pub draft: Option<ProviderDraft>,
    pub completed_files: usize,
    pub completed_removals: usize,
    pub transfer: Option<Transfer>,
}

impl DraftCheckpoint {
    pub fn advance(&mut self, stage: DraftStage) {
        self.stage = stage;
        self.stage_started_at = Utc::now();
    }
}

#[derive(Clone)]
pub struct DraftLease {
    pub message_id: Uuid,
    pub lease_id: Uuid,
    pub mailbox: MailboxKey,
    pub revision: i64,
    pub actor_id: String,
    pub input: ResolvedDraftInput,
    pub attachments: crate::domain::models::draft_attachment_manifest::DraftAttachmentManifest,
    pub provider_id: Option<ProviderId>,
    pub base_version: Option<String>,
    pub delete_requested: bool,
    pub checkpoint: Option<DraftCheckpoint>,
}

/// Persisted user-visible outcome. Unknown is never an automatic retry instruction.
#[derive(Debug, Clone, Copy)]
pub enum DraftFailure {
    Conflict,
    CreationUnknown,
    AttachmentUnknown,
    SendUnknown,
    SendRejected,
    Denied,
    Invalid,
}

impl DraftFailure {
    pub fn code(self) -> &'static str {
        match self {
            Self::Conflict => "draft_conflict",
            Self::CreationUnknown => "creation_unknown",
            Self::AttachmentUnknown => "attachment_unknown",
            Self::SendUnknown => "send_unknown",
            Self::SendRejected => "send_rejected",
            Self::Denied => "access_revoked",
            Self::Invalid => "invalid_content",
        }
    }
    pub fn state(self) -> &'static str {
        match self {
            Self::Conflict => "conflict",
            Self::CreationUnknown | Self::AttachmentUnknown | Self::SendUnknown => "unknown",
            Self::Denied => "cancelled",
            Self::Invalid | Self::SendRejected => "failed",
        }
    }
}

/// The final transaction may discover that cancellation or revocation won the race.
pub enum DeliveryStart {
    Started,
    NotDue,
    Denied,
}

/// Rollout pauses provider writes while keeping uncertain outcomes observable.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DraftClaimMode {
    All,
    Reconciliation,
}
