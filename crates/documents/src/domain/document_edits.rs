//! Typed edits of markdown documents without a model: read the XML structure
//! agents address by node id, then commit a batch of ops built against it.

use super::ai_editing::{AiEditError, AiEditRequest, AiEditingService};
use super::models::DocumentError;
use super::permission_token::encode_permission_token;
use super::ports::editing::{
    DocumentOp, DocumentOpFailure, DocumentOpsOutcome, EditMode, EditingWorkerService, EditorName,
};
use ai_billing::domain::admission::AiAdmissionError;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityType, RequiredPermission,
    ViewAccessLevel,
};
use macro_sync_service_jwt::DocumentPermissionToken;
use model::document::{DocumentBasic, FileType};
use models_permissions::share_permission::access_level::AccessLevel;
use std::future::Future;

#[cfg(test)]
mod test;

/// Most ops one batch may carry.
pub const MAX_DOCUMENT_OPERATIONS: usize = 200;

/// The live document's XML view, with durable node ids as attributes.
pub trait LiveDocumentXmlReader: Send + Sync {
    /// Export the current document as XML, including recent edits.
    fn xml(&self, document_id: &str) -> impl Future<Output = Result<String, DocumentError>> + Send;
}

/// A markdown document's structure, the format `EditDocument`'s model reads.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct DocumentStructure {
    /// Document XML; every block carries its node id.
    pub xml: String,
}

/// A committed batch.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentEditsApplied {
    /// Number of ops applied.
    pub applied: usize,
    /// Durable ids of the blocks the batch touched.
    pub changed_block_ids: Vec<String>,
    /// The document's version after the batch, as sync-service encodes it.
    pub revision: String,
}

/// A completed edit by instructions.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentAiEdited {
    /// What changed, in words.
    pub summary: String,
    /// Durable ids of the blocks the edit touched.
    pub changed_block_ids: Vec<String>,
    /// The document's version after the edit, as sync-service encodes it.
    pub revision: String,
}

/// Why an edit by instructions did not complete.
#[derive(Debug, thiserror::Error)]
pub enum DocumentAiEditError {
    /// Access, file type, request shape, or token minting.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// AI admission refused the caller; no model ran.
    #[error("{0}")]
    Admission(AiAdmissionError),
    /// The editor could not do the edit and changed nothing.
    #[error("edit refused: {0}")]
    Refused(String),
    /// The edit failed after it started, so it may have partly applied.
    #[error("edit failed: {0}")]
    Failed(anyhow::Error),
}

/// Why a batch of ops was not committed, or may not have been.
#[derive(Debug, thiserror::Error)]
pub enum DocumentEditError {
    /// Access, file type, request shape, or an internal failure.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// Ops failed against the live document; nothing was committed.
    #[error("{} operation(s) could not be applied", .0.len())]
    Rejected(Vec<DocumentOpFailure>),
    /// The batch was sent but never acknowledged: it may have applied.
    #[error("edit outcome unknown: {0}")]
    Unacknowledged(String),
}

fn ensure_markdown<Permission: RequiredPermission>(
    access: &EntityAccessReceipt<Permission>,
    document: &DocumentBasic,
) -> Result<(), DocumentError> {
    if access.entity().entity_type != EntityType::Document
        || access.entity().entity_id != document.document_id
    {
        return Err(DocumentError::Unauthorized);
    }
    if document.try_file_type() != Some(FileType::Md) {
        return Err(DocumentError::BadRequest(
            "document is not a markdown document".to_string(),
        ));
    }
    Ok(())
}

/// Read a markdown document's structure with its view receipt.
pub async fn read_structure<Reader: LiveDocumentXmlReader>(
    reader: &Reader,
    access: EntityAccessReceipt<ViewAccessLevel>,
    document: &DocumentBasic,
) -> Result<DocumentStructure, DocumentError> {
    ensure_markdown(&access, document)?;
    let xml = reader.xml(&document.document_id).await?;
    Ok(DocumentStructure { xml })
}

/// Commit a batch of ops to a markdown document with its edit receipt, all
/// or nothing. The worker token carries the caller's user and bot exactly as
/// `EditDocument`'s does, so the edit is attributed the same way.
#[tracing::instrument(
    skip_all,
    fields(document_id = %document.document_id, operations = operations.len()),
    err
)]
pub async fn apply_operations<Worker: EditingWorkerService>(
    worker: &Worker,
    jwt_secret: &str,
    access: EntityAccessReceipt<EditAccessLevel>,
    document: &DocumentBasic,
    operations: &[DocumentOp],
) -> Result<DocumentEditsApplied, DocumentEditError> {
    ensure_markdown(&access, document)?;
    if operations.is_empty() || operations.len() > MAX_DOCUMENT_OPERATIONS {
        return Err(DocumentError::BadRequest(format!(
            "a batch carries 1 to {MAX_DOCUMENT_OPERATIONS} operations, not {}",
            operations.len()
        ))
        .into());
    }

    let (document_token, editor) = edit_token(&access, document, jwt_secret)?;
    let outcome = worker
        .document_ops(&document.document_id, &document_token, operations, editor)
        .await
        .map_err(DocumentError::Internal)?;
    match outcome {
        DocumentOpsOutcome::Applied {
            applied,
            changed_block_ids,
            revision,
        } => Ok(DocumentEditsApplied {
            applied,
            changed_block_ids,
            revision,
        }),
        DocumentOpsOutcome::Rejected(failures) => Err(DocumentEditError::Rejected(failures)),
        DocumentOpsOutcome::Invalid(message) => Err(DocumentError::BadRequest(message).into()),
        DocumentOpsOutcome::Unacknowledged(message) => {
            Err(DocumentEditError::Unacknowledged(message))
        }
    }
}

/// Mint the worker token and cursor name for an edit receipt: the caller's
/// user and bot, as `EditDocument` attributes its edits.
fn edit_token(
    access: &EntityAccessReceipt<EditAccessLevel>,
    document: &DocumentBasic,
    jwt_secret: &str,
) -> Result<(DocumentPermissionToken, Option<EditorName>), DocumentError> {
    let bot = match access.auth() {
        EntityAccessAuth::Bot(bot) => Some(bot.bot_id()),
        EntityAccessAuth::Authenticated(_)
        | EntityAccessAuth::Unauthenticated
        | EntityAccessAuth::Internal => None,
    };
    let user = access.acting_user_id();
    if user.is_none() && bot.is_none() {
        return Err(DocumentError::Unauthorized);
    }
    let document_token = encode_permission_token(
        user.map(ToString::to_string),
        document.document_id.clone(),
        AccessLevel::Edit,
        jwt_secret,
        bot.map(|bot| bot.into_storage_id().to_string()),
    )?;
    let editor =
        bot.and_then(|bot| bot_id::system_bot(bot).and_then(|bot| EditorName::new(bot.name)));
    Ok((document_token, editor))
}

/// Edit a markdown document by natural-language instructions with its edit
/// receipt, through `EditDocument`'s pipeline: the same admission, models and
/// metering. Dropping this future drops the worker request, which aborts the
/// worker's edit; never detach it.
#[tracing::instrument(
    skip_all,
    fields(document_id = %document.document_id, fast, instructions_len = instructions.len()),
    err
)]
pub async fn edit_with_instructions<Worker: EditingWorkerService>(
    editing: &AiEditingService<Worker>,
    jwt_secret: &str,
    access: EntityAccessReceipt<EditAccessLevel>,
    document: &DocumentBasic,
    instructions: &str,
    fast: bool,
) -> Result<DocumentAiEdited, DocumentAiEditError> {
    ensure_markdown(&access, document)?;
    if instructions.trim().is_empty() {
        return Err(DocumentError::BadRequest("instructions are empty".to_string()).into());
    }
    // Admission and metering bill a user; a bot with no acting user has none.
    let caller = access
        .acting_user_id()
        .cloned()
        .ok_or(DocumentError::Unauthorized)?;
    let (document_token, editor) = edit_token(&access, document, jwt_secret)?;
    let mode = if fast {
        EditMode::Fast
    } else {
        EditMode::Supervised
    };
    let result = editing
        .edit(
            access,
            &caller,
            AiEditRequest {
                document_token: &document_token,
                instructions,
                mode,
                editor,
            },
        )
        .await
        .map_err(|error| match error {
            AiEditError::Admission(error) => DocumentAiEditError::Admission(error),
            AiEditError::Worker(error) => DocumentAiEditError::Failed(error),
        })?;
    if let Some(reason) = result.clarification {
        return Err(DocumentAiEditError::Refused(reason));
    }
    let (Some(summary), Some(revision)) = (result.summary, result.revision) else {
        return Err(DocumentAiEditError::Failed(anyhow::anyhow!(
            "editing worker reported no summary or revision"
        )));
    };
    Ok(DocumentAiEdited {
        summary,
        changed_block_ids: result.changed_block_ids,
        revision,
    })
}
