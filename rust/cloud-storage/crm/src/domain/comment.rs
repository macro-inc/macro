//! Domain (and wire) models for CRM comment threads.
//!
//! A CRM comment thread mirrors the document `Thread`/`Comment` shape closely
//! enough that the frontend reuses its thread-assembly and rendering logic,
//! but threads hang off a CRM company or contact (not a document) and use
//! uuid ids. `entityType` + `entityId` replace the document `documentId`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Which CRM entity a comment thread is attached to. Serializes to
/// `crm_company` / `crm_contact` — matching the `entityType` the frontend
/// uses elsewhere when building entity URLs — and is parsed from the
/// `{entity_type}` path segment on the comment routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum CrmCommentEntityType {
    /// Thread attached to a `crm_companies` row.
    CrmCompany,
    /// Thread attached to a `crm_contacts` row.
    CrmContact,
}

/// A CRM comment thread: the parent record one or more comments hang off.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CrmThread {
    /// The thread id.
    pub thread_id: Uuid,
    /// Which CRM entity kind this thread belongs to.
    pub entity_type: CrmCommentEntityType,
    /// The id of the CRM company or contact this thread belongs to.
    pub entity_id: Uuid,
    /// Macro user id of the thread creator.
    pub owner: String,
    /// Whether the thread is resolved.
    pub resolved: bool,
    /// Arbitrary client metadata.
    pub metadata: Option<Value>,
    /// When the thread was created.
    pub created_at: DateTime<Utc>,
    /// When the thread was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the thread was soft-deleted, if ever.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A single comment within a [`CrmThread`].
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CrmComment {
    /// The comment id.
    pub comment_id: Uuid,
    /// The id of the thread this comment belongs to.
    pub thread_id: Uuid,
    /// Optional explicit ordering within the thread; the frontend falls
    /// back to `createdAt` when absent.
    pub order: Option<i32>,
    /// Macro user id of the comment author.
    pub owner: String,
    /// Macro user id of the actual sender, when distinct from `owner`.
    pub sender: Option<String>,
    /// The comment body (markdown).
    pub text: String,
    /// Arbitrary client metadata.
    pub metadata: Option<Value>,
    /// When the comment was created.
    pub created_at: DateTime<Utc>,
    /// When the comment was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the comment was soft-deleted, if ever.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A [`CrmThread`] with its comments nested under it — the unit the
/// frontend renders.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CrmCommentThread {
    /// The thread.
    pub thread: CrmThread,
    /// The thread's comments, oldest first.
    pub comments: Vec<CrmComment>,
}

/// Outcome of soft-deleting a CRM comment: reports whether the parent thread
/// was soft-deleted too (it is when the deleted comment was its last live one).
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DeleteCrmCommentResult {
    /// The deleted comment's id.
    pub comment_id: Uuid,
    /// The thread the comment belonged to.
    pub thread_id: Uuid,
    /// Whether the thread itself was soft-deleted because no live comments
    /// remained.
    pub thread_deleted: bool,
}
