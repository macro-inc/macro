//! Read a markdown document's body with its revision, and replace the body
//! only while the document is still at the revision the caller read, so a
//! writer never overwrites an edit it did not see.

use super::ai_edit::{ensure_markdown, worker_token};
use super::models::DocumentError;
use super::ports::editing::{EditingWorkerService, MarkdownWrite};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use permissions_types::share_permission::access_level::AccessLevel;
use shared_types::document::DocumentBasic;

#[cfg(test)]
mod test;

/// A markdown document's body and the revision it was read at.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentMarkdown {
    /// The body as Markdown, in the format `text-content` returns.
    pub markdown: String,
    /// The document's version, as sync-service encodes it. Pass it back to
    /// write the body only if nobody has changed the document since.
    pub revision: String,
}

/// A body write that landed, or found the body already reading that way.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentMarkdownWritten {
    /// The document's version after the write.
    pub revision: String,
    /// Whether the body changed; `false` when it already read that way.
    pub changed: bool,
}

/// Why a body read or write did not complete.
#[derive(Debug, thiserror::Error)]
pub enum DocumentMarkdownError {
    /// Access, file type, or token minting.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// The document changed since the caller read it; nothing was written.
    #[error("the document changed since it was read")]
    Conflict,
    /// The body could not be read.
    #[error("markdown read failed: {0}")]
    ReadFailed(anyhow::Error),
    /// The write failed after it was sent, so it may have applied.
    #[error("markdown write failed: {0}")]
    WriteFailed(anyhow::Error),
}

/// Read a markdown document's body and revision with its view receipt.
#[tracing::instrument(skip_all, fields(document_id = %document.document_id), err)]
pub async fn read_markdown<Worker: EditingWorkerService>(
    worker: &Worker,
    jwt_secret: &str,
    access: EntityAccessReceipt<ViewAccessLevel>,
    document: &DocumentBasic,
) -> Result<DocumentMarkdown, DocumentMarkdownError> {
    ensure_markdown(&access, document)?;
    let (document_token, _) = worker_token(&access, AccessLevel::View, jwt_secret)?;
    worker
        .read_markdown(&document.document_id, &document_token)
        .await
        .map_err(DocumentMarkdownError::ReadFailed)
}

/// Replace a markdown document's body with its edit receipt, only if the
/// document is still at `expected_revision`.
#[tracing::instrument(
    skip_all,
    fields(document_id = %document.document_id, markdown_len = markdown.len()),
    err
)]
pub async fn write_markdown<Worker: EditingWorkerService>(
    worker: &Worker,
    jwt_secret: &str,
    access: EntityAccessReceipt<EditAccessLevel>,
    document: &DocumentBasic,
    expected_revision: &str,
    markdown: &str,
) -> Result<DocumentMarkdownWritten, DocumentMarkdownError> {
    ensure_markdown(&access, document)?;
    if expected_revision.is_empty() {
        return Err(DocumentError::BadRequest("expectedRevision is empty".to_string()).into());
    }
    let (document_token, _) = worker_token(&access, AccessLevel::Edit, jwt_secret)?;
    let write = worker
        .write_markdown(
            &document.document_id,
            &document_token,
            expected_revision,
            markdown,
        )
        .await
        .map_err(DocumentMarkdownError::WriteFailed)?;
    match write {
        MarkdownWrite::Written(written) => Ok(written),
        MarkdownWrite::Conflict => Err(DocumentMarkdownError::Conflict),
    }
}
