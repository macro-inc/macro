//! Edit a markdown document by natural-language instructions over HTTP,
//! through `EditDocument`'s AI-editing pipeline.

use super::ai_editing::{AiEditError, AiEditRequest, AiEditingService};
use super::models::DocumentError;
use super::permission_token::encode_permission_token;
use super::ports::editing::{EditMode, EditingWorkerService, EditorName};
use ai_billing::domain::admission::AiAdmissionError;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityType,
};
use macro_sync_service_jwt::DocumentPermissionToken;
use model::document::{DocumentBasic, FileType};
use models_permissions::share_permission::access_level::AccessLevel;

#[cfg(test)]
mod test;

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
    /// What the editor needs to know to finish, when it applied part of the
    /// edit and stopped; the applied part stays.
    pub clarification: Option<String>,
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
    /// The editor could not do the edit and applied nothing.
    #[error("edit refused: {0}")]
    Refused(String),
    /// The edit failed after it started, so it may have partly applied.
    #[error("edit failed: {0}")]
    Failed(anyhow::Error),
}

fn ensure_markdown(
    access: &EntityAccessReceipt<EditAccessLevel>,
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
    // A clarification with applied ops is a partial edit, not a refusal: the
    // caller must see what changed so a retry doesn't apply it twice.
    if result.edits_applied == 0
        && let Some(reason) = result.clarification
    {
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
        clarification: result.clarification,
    })
}
