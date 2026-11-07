//! Attachment identities frozen with a particular committed draft revision.
use super::AttachmentDraft;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DraftAttachmentManifest {
    #[serde(default)]
    pub uploads: Vec<AttachmentDraft>,
    #[serde(default)]
    pub forwarded: Vec<FrozenForwardedAttachment>,
    #[serde(default)]
    pub removals: Vec<AttachmentRemoval>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrozenForwardedAttachment {
    pub id: Uuid,
    pub link_id: Uuid,
    pub thread_id: Uuid,
    pub grant_generation: i64,
    pub provider_id: Option<String>,
    pub provider_attachment_id: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub content_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum AttachmentRemoval {
    ProviderId(String),
    ContentId(String),
}
