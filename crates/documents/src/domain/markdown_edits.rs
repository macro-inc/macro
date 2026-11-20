//! Direct edits to a markdown document's body, with no model: exact
//! `old`/`new` replacements and insert, delete and move by block id, applied
//! as one batch by the editing worker. Edited blocks keep their ids and
//! comment marks; the batch merges with edits made since `base_revision`.

use super::ai_edit::{ensure_markdown, worker_token};
use super::models::DocumentError;
use super::ports::editing::{EditingWorkerService, MarkdownEditOutcome};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_sync_service_jwt::DocumentPermissionToken;
use model::document::DocumentBasic;
use models_permissions::share_permission::access_level::AccessLevel;

#[cfg(test)]
mod test;

/// The most edits one batch may hold.
pub const MAX_EDITS: usize = 200;
const MAX_BLOCK_ID_CHARS: usize = 256;

/// A top-level block's durable id, or `start` / `end` where an edit takes a
/// position.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(try_from = "String", into = "String")]
pub struct BlockId(String);

impl BlockId {
    /// The id as the document has it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for BlockId {
    type Error = String;

    fn try_from(id: String) -> Result<Self, Self::Error> {
        if id.is_empty() || id.chars().count() > MAX_BLOCK_ID_CHARS {
            return Err(format!(
                "a block id is 1 to {MAX_BLOCK_ID_CHARS} characters"
            ));
        }
        Ok(Self(id))
    }
}

impl From<BlockId> for String {
    fn from(id: BlockId) -> Self {
        id.0
    }
}

/// Replace exact text: `old` must occur once (in `block_id` when given, else
/// anywhere) unless `replace_all` is set.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ReplaceEdit {
    /// Limit the match to this block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_id: Option<BlockId>,
    /// Exact internal markdown to find, copied from the block's content.
    pub old: String,
    /// Its replacement. Empty deletes it.
    pub new: String,
    /// Replace every occurrence within blocks instead of requiring exactly
    /// one. An `old` spanning blocks must still occur once: `replace_all`
    /// does not apply to matches across blocks.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replace_all: bool,
}

/// Insert new blocks after a block, or after `start` / at `end`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct InsertAfterEdit {
    /// A block id, `start` or `end`.
    pub insert_after: BlockId,
    /// Internal markdown of the new blocks.
    pub markdown: String,
}

/// Insert new blocks before a block, or at `start` / before `end`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct InsertBeforeEdit {
    /// A block id, `start` or `end`.
    pub insert_before: BlockId,
    /// Internal markdown of the new blocks.
    pub markdown: String,
}

/// Delete a block.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct DeleteEdit {
    /// The block to delete.
    pub delete: BlockId,
}

/// Move a block after another (or after `start`), keeping its ids.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct MoveAfterEdit {
    /// The block to move.
    #[serde(rename = "move")]
    pub block: BlockId,
    /// A block id, `start` or `end`.
    pub after: BlockId,
}

/// Move a block before another (or before `end`), keeping its ids.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct MoveBeforeEdit {
    /// The block to move.
    #[serde(rename = "move")]
    pub block: BlockId,
    /// A block id, `start` or `end`.
    pub before: BlockId,
}

/// One edit of a batch. The shapes mirror `str_replace`-style editing tools,
/// told apart by their fields, so the input is untagged.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(untagged)]
pub enum MarkdownEdit {
    /// `{old, new, block_id?, replace_all?}`
    Replace(ReplaceEdit),
    /// `{insert_after, markdown}`
    InsertAfter(InsertAfterEdit),
    /// `{insert_before, markdown}`
    InsertBefore(InsertBeforeEdit),
    /// `{delete}`
    Delete(DeleteEdit),
    /// `{move, after}`
    MoveAfter(MoveAfterEdit),
    /// `{move, before}`
    MoveBefore(MoveBeforeEdit),
}

/// A batch of direct edits, applied whole or not at all.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkdownEditRequest {
    /// The edits, applied in order: 1 to 200.
    #[cfg_attr(feature = "axum", schema(min_items = 1, max_items = 200))]
    pub edits: Vec<MarkdownEdit>,
    /// The `revision` the edits were written against. Changes made since
    /// merge with the batch; absent means the current revision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_revision: Option<String>,
    /// Compute and verify the batch, return its changes, write nothing.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dry_run: bool,
    /// The batch means to delete blocks holding comments or content
    /// markdown cannot show, or most of the document.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub allow_deleting_content: bool,
}

/// One top-level block as edits address it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MarkdownBlock {
    /// The block's durable id.
    pub id: BlockId,
    /// The editor node type: paragraph, heading, table…
    #[serde(rename = "type")]
    pub block_type: String,
    /// Its internal markdown; an opaque block shows `<!-- keep:ID -->`.
    pub markdown: String,
    /// Markdown cannot show this block: it can be moved or deleted, not edited.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub opaque: bool,
}

/// A markdown document's blocks with the revision they were read at.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentMarkdownBlocks {
    /// The document's version; pass it as `baseRevision` with edits.
    pub revision: String,
    /// Top-level blocks in document order.
    pub blocks: Vec<MarkdownBlock>,
}

/// What a batch did to one block.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MarkdownBlockChange {
    /// The block's markdown changed; its id stayed.
    #[serde(rename_all = "camelCase")]
    Edited {
        /// The block.
        block_id: BlockId,
        /// Its markdown before.
        before: String,
        /// Its markdown after.
        after: String,
    },
    /// A new block.
    #[serde(rename_all = "camelCase")]
    Inserted {
        /// The new block's id.
        block_id: BlockId,
        /// The block now before it; none at the start.
        after_block_id: Option<BlockId>,
        /// Its markdown.
        markdown: String,
    },
    /// A deleted block.
    #[serde(rename_all = "camelCase")]
    Deleted {
        /// The block.
        block_id: BlockId,
        /// Its markdown before the delete.
        markdown: String,
    },
    /// A block moved, keeping its id.
    #[serde(rename_all = "camelCase")]
    Moved {
        /// The block.
        block_id: BlockId,
        /// The block now before it; none at the start.
        after_block_id: Option<BlockId>,
    },
}

/// Whether the batch was written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MarkdownEditOutcomeKind {
    /// Written.
    Committed,
    /// The document already read that way; nothing written.
    Unchanged,
    /// A dry run: computed and verified, nothing written.
    DryRun,
    /// This request (same document, base revision and batch) committed
    /// before; nothing was written again. `changes` is empty: read the blocks
    /// again for the ids of blocks the first commit inserted.
    AlreadyApplied,
}

/// How the batch was placed on the document as it is now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MarkdownEditMerge {
    /// Computed on the current document.
    Current,
    /// Computed at the base revision and merged with later edits.
    Base,
    /// The merge did not read back right, so it was recomputed on the
    /// current document.
    Rebased,
}

/// A batch that applied, or a dry run that would.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEdited {
    /// Written, unchanged, or a dry run.
    pub outcome: MarkdownEditOutcomeKind,
    /// The document's revision after the write (the current one otherwise).
    pub revision: String,
    /// What changed, block by block; empty for `unchanged` and
    /// `already_applied` (read the blocks again for inserted ids then).
    pub changes: Vec<MarkdownBlockChange>,
    /// How the batch was placed; absent for `already_applied`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge: Option<MarkdownEditMerge>,
}

/// Why a batch was refused; the document is untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MarkdownEditRefusalCode {
    /// `old` does not occur.
    NoMatch,
    /// `old` occurs more than once without `replace_all`.
    AmbiguousMatch,
    /// An id names no block.
    UnknownBlock,
    /// No edits, an empty `old`, or empty markdown to insert.
    EmptyEdit,
    /// Markup (a mention, a table) that did not parse.
    Unparseable,
    /// An edit to a block markdown cannot show, or its delete without
    /// `allowDeletingContent`.
    OpaqueEdit,
    /// Deleting a block with a comment without `allowDeletingContent`.
    CommentLoss,
    /// Removing most of the document without `allowDeletingContent`.
    MassDelete,
    /// Literal markup would end up in the text.
    MarkupLeak,
    /// An embedded or uploaded image or video changed.
    FrozenMedia,
    /// The edited document would exceed the size limit.
    TooLarge,
    /// The result did not read back as edited.
    VerifyFailed,
}

/// A block a missing or ambiguous `old` was found in, or is nearest to.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEditMatchingBlock {
    /// The block.
    pub block_id: BlockId,
    /// How often `old` occurs in it (0 for a no-match suggestion).
    pub occurrences: u32,
    /// Its markdown as the batch saw it.
    pub markdown: String,
}

/// A refused batch: what was wrong and where.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEditRefusal {
    /// What was wrong.
    pub code: MarkdownEditRefusalCode,
    /// What to change; may quote the document.
    pub message: String,
    /// The 1-based edit it concerns, when one.
    pub edit: Option<u32>,
    /// For `no_match` and `ambiguous_match`, the blocks `old` was found in or
    /// is nearest to.
    #[serde(default)]
    pub blocks: Vec<MarkdownEditMatchingBlock>,
}

/// Why a batch conflicts with the document as it is now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum MarkdownEditConflictReason {
    /// The document changed since the base revision so that an edit no
    /// longer applies: read it again and redo the edit.
    Changed,
    /// Other edits kept landing while this one committed: retry it as is.
    Busy,
}

/// A batch that conflicts with the document as it is now; nothing was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownEditConflict {
    /// Why.
    pub reason: MarkdownEditConflictReason,
    /// What happened, for the caller; may quote the document.
    pub message: String,
}

/// Why direct edits did not complete.
#[derive(Debug, thiserror::Error)]
pub enum MarkdownEditError {
    /// Access, file type, token minting, or an invalid batch.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// The batch was refused; nothing was written.
    #[error("{}", .0.message)]
    Refused(MarkdownEditRefusal),
    /// The batch conflicts with the document as it is now; nothing was
    /// written.
    #[error("{}", .0.message)]
    Conflict(MarkdownEditConflict),
    /// The blocks could not be read.
    #[error("markdown blocks read failed: {0}")]
    ReadFailed(anyhow::Error),
    /// The batch failed after it was sent, so it may have applied.
    #[error("markdown edit failed: {0}")]
    WriteFailed(anyhow::Error),
}

/// Read a markdown document's blocks and revision with its view receipt.
#[tracing::instrument(skip_all, fields(document_id = %document.document_id), err)]
pub async fn read_markdown_blocks<Worker: EditingWorkerService>(
    worker: &Worker,
    jwt_secret: &str,
    access: EntityAccessReceipt<ViewAccessLevel>,
    document: &DocumentBasic,
) -> Result<DocumentMarkdownBlocks, MarkdownEditError> {
    ensure_markdown(&access, document)?;
    let (document_token, _) = worker_token(&access, AccessLevel::View, jwt_secret)?;
    worker
        .markdown_blocks(&document.document_id, &document_token)
        .await
        .map_err(MarkdownEditError::ReadFailed)
}

/// Apply direct edits with the caller's edit receipt.
#[tracing::instrument(
    skip_all,
    fields(document_id = %document.document_id, edits = request.edits.len(), dry_run = request.dry_run),
    err
)]
pub async fn edit_markdown<Worker: EditingWorkerService>(
    worker: &Worker,
    jwt_secret: &str,
    access: EntityAccessReceipt<EditAccessLevel>,
    document: &DocumentBasic,
    request: &MarkdownEditRequest,
) -> Result<MarkdownEdited, MarkdownEditError> {
    ensure_markdown(&access, document)?;
    let (document_token, _) = worker_token(&access, AccessLevel::Edit, jwt_secret)?;
    apply_markdown_edits(worker, &document.document_id, &document_token, request).await
}

/// Apply direct edits with a token the caller minted after checking edit
/// access to a markdown document (`EditDocument` attributes it to its agent).
pub async fn apply_markdown_edits<Worker: EditingWorkerService>(
    worker: &Worker,
    document_id: &str,
    document_token: &DocumentPermissionToken,
    request: &MarkdownEditRequest,
) -> Result<MarkdownEdited, MarkdownEditError> {
    if request.edits.is_empty() || request.edits.len() > MAX_EDITS {
        return Err(
            DocumentError::BadRequest(format!("edits must hold 1 to {MAX_EDITS} edits")).into(),
        );
    }
    if request.base_revision.as_deref() == Some("") {
        return Err(DocumentError::BadRequest("baseRevision is empty".to_string()).into());
    }
    match worker
        .edit_markdown(document_id, document_token, request)
        .await
        .map_err(MarkdownEditError::WriteFailed)?
    {
        MarkdownEditOutcome::Applied(edited) => Ok(edited),
        MarkdownEditOutcome::Refused(refusal) => Err(MarkdownEditError::Refused(refusal)),
        MarkdownEditOutcome::Conflict(conflict) => Err(MarkdownEditError::Conflict(conflict)),
        MarkdownEditOutcome::Invalid(message) => Err(DocumentError::BadRequest(message).into()),
    }
}
