//! Deterministic edits of markdown documents as Lexical state, with no model:
//! read the live document as a Lexical editor state with its revision, then
//! commit the changed top-level blocks, merged three-way by the editing
//! worker against that revision.

use super::ai_edit::{ensure_markdown, worker_token};
use super::models::DocumentError;
use super::ports::editing::EditingWorkerService;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use model::document::DocumentBasic;
use models_permissions::share_permission::access_level::AccessLevel;

#[cfg(test)]
mod test;

/// Most top-level blocks one commit may carry.
pub const MAX_LEXICAL_BLOCKS: usize = 500;

/// A markdown document read as Lexical state.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentLexicalState {
    /// The serialized Lexical editor state, normalized through a headless
    /// editor with every Macro node registered.
    #[cfg_attr(feature = "axum", schema(value_type = Object))]
    pub state: serde_json::Value,
    /// The document version the state was read at, as sync-service encodes
    /// it. Commit against it.
    pub revision: String,
}

/// One new, changed or moved top-level block.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentLexicalBlock {
    /// The block's durable node id; equals the id inside `node`.
    pub id: String,
    /// The id of the top-level block this one follows, or `null` for first.
    pub after: Option<String>,
    /// The block's serialized Lexical node, ids included.
    #[cfg_attr(feature = "axum", schema(value_type = Object))]
    pub node: serde_json::Value,
}

/// The change to a document's top-level blocks since `revision`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentLexicalCommitRequest {
    /// The revision the change was made against, from the read.
    pub revision: String,
    /// Every new, changed or moved top-level block, in document order; at most 500.
    #[cfg_attr(feature = "axum", schema(max_items = 500))]
    pub blocks: Vec<DocumentLexicalBlock>,
    /// Ids of the top-level blocks the change removes.
    pub removed: Vec<String>,
}

/// A committed change.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentLexicalCommitted {
    /// The document's version after the commit.
    pub revision: String,
    /// The live document after the commit, merged with everyone's edits and
    /// normalized as a read is.
    #[cfg_attr(feature = "axum", schema(value_type = Object))]
    pub state: serde_json::Value,
}

/// Why a node could not merge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum DocumentLexicalConflictReason {
    /// Someone else changed the node the commit changes or removes.
    Changed,
    /// Someone else removed the node the commit changes.
    Removed,
    /// Both sides moved the node to different places.
    Moved,
    /// The revision is not a version of this document.
    Revision,
}

/// One node of a commit that could not merge with the live document.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct DocumentLexicalNodeConflict {
    /// The node's id; `null` for a `revision` conflict.
    pub id: Option<String>,
    /// Why it could not merge.
    pub reason: DocumentLexicalConflictReason,
}

/// What became of a commit sent to the editing worker.
#[derive(Debug, Clone, PartialEq)]
pub enum LexicalCommitOutcome {
    /// Merged and acknowledged by storage.
    Committed(DocumentLexicalCommitted),
    /// At least one node could not merge; nothing was applied.
    Conflict(Vec<DocumentLexicalNodeConflict>),
    /// The blocks are malformed; nothing was applied.
    Invalid(String),
    /// The change may or may not have applied: storage never acknowledged it,
    /// or the worker failed after the request was sent.
    Unacknowledged(String),
}

/// Why a commit did not land, or may not have.
#[derive(Debug, thiserror::Error)]
pub enum DocumentLexicalError {
    /// Access, file type, request shape, or an internal failure before the
    /// change was sent.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// At least one node could not merge; nothing was applied.
    #[error("{} node(s) could not merge", .0.len())]
    Conflict(Vec<DocumentLexicalNodeConflict>),
    /// The blocks are malformed; nothing was applied.
    #[error("invalid commit: {0}")]
    Invalid(String),
    /// The change may or may not have applied.
    #[error("commit outcome unknown: {0}")]
    OutcomeUnknown(String),
}

/// Read a markdown document as Lexical state with its view receipt, through
/// a view-level worker token for the caller's user and bot.
#[tracing::instrument(skip_all, fields(document_id = %document.document_id), err)]
pub async fn read_lexical<Worker: EditingWorkerService>(
    worker: &Worker,
    jwt_secret: &str,
    access: EntityAccessReceipt<ViewAccessLevel>,
    document: &DocumentBasic,
) -> Result<DocumentLexicalState, DocumentError> {
    ensure_markdown(&access, document)?;
    let (document_token, _) = worker_token(&access, document, AccessLevel::View, jwt_secret)?;
    worker
        .lexical_state(&document.document_id, &document_token)
        .await
        .map_err(DocumentError::Internal)
}

/// Commit changed top-level blocks to a markdown document with its edit
/// receipt, all or nothing. The worker token and cursor name carry the
/// caller's user and bot, as `EditDocument` attributes its edits. Dropping
/// this future drops the worker request; never detach it.
#[tracing::instrument(
    skip_all,
    fields(
        document_id = %document.document_id,
        blocks = commit.blocks.len(),
        removed = commit.removed.len(),
        outcome,
        conflicts,
    ),
    err(level = "warn")
)]
pub async fn commit_lexical<Worker: EditingWorkerService>(
    worker: &Worker,
    jwt_secret: &str,
    access: EntityAccessReceipt<EditAccessLevel>,
    document: &DocumentBasic,
    commit: &DocumentLexicalCommitRequest,
) -> Result<DocumentLexicalCommitted, DocumentLexicalError> {
    ensure_markdown(&access, document)?;
    if commit.blocks.len() > MAX_LEXICAL_BLOCKS {
        return Err(DocumentError::BadRequest(format!(
            "a commit carries at most {MAX_LEXICAL_BLOCKS} blocks, not {}",
            commit.blocks.len()
        ))
        .into());
    }

    let (document_token, editor) = worker_token(&access, document, AccessLevel::Edit, jwt_secret)?;
    let outcome = worker
        .lexical_commit(&document.document_id, &document_token, commit, editor)
        .await
        .map_err(DocumentError::Internal)?;

    let span = tracing::Span::current();
    match outcome {
        LexicalCommitOutcome::Committed(committed) => {
            span.record("outcome", "committed");
            Ok(committed)
        }
        LexicalCommitOutcome::Conflict(conflicts) => {
            span.record("outcome", "conflict");
            span.record("conflicts", conflicts.len());
            Err(DocumentLexicalError::Conflict(conflicts))
        }
        LexicalCommitOutcome::Invalid(message) => {
            span.record("outcome", "invalid");
            Err(DocumentLexicalError::Invalid(message))
        }
        LexicalCommitOutcome::Unacknowledged(message) => {
            span.record("outcome", "outcome_unknown");
            Err(DocumentLexicalError::OutcomeUnknown(message))
        }
    }
}
