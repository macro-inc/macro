use crate::{
    api::context::ApiContext, model::response::instructions::CreateInstructionsDocumentResponse,
};
use axum::{Json, extract::State};
use documents_hex::domain::create::{NewDocumentMetadata, NewMarkdownTextDocument};
use documents_hex::domain::models::DocumentError;
use documents_hex::domain::ports::create::DocumentCreationService as _;
use macro_db_client::instructions::create::{
    CreateInstructionsError, insert_instructions_document,
};
use macro_db_client::instructions::get::get_instructions_document;
use model::response::GenericErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_dcs::constants::INSTRUCTIONS_FILE_NAME;

/// Creates an instructions document for the current user
#[utoipa::path(
    post,
    path = "/instructions",
    responses(
        (status = 200, body = CreateInstructionsDocumentResponse),
        (status = 401, body = GenericErrorResponse),
        (status = 409, body = GenericErrorResponse, description = "User already has instructions document"),
        (status = 500, body = GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=%user_context.macro_user_id))]
pub async fn create_instructions_handler(
    State(ctx): State<ApiContext>,
    user_context: MacroUserExtractor,
) -> Result<Json<CreateInstructionsDocumentResponse>, DocumentError> {
    let user_id = user_context.macro_user_id;

    if get_instructions_document(&ctx.db, user_id.clone())
        .await
        .map_err(DocumentError::Internal)?
        .is_some()
    {
        return Err(DocumentError::Conflict(
            "User already has an instructions document".to_string(),
        ));
    }

    let created = ctx
        .documents_state
        .creator
        .create_markdown_text(
            user_id.clone(),
            NewMarkdownTextDocument::empty_note(NewDocumentMetadata::new(INSTRUCTIONS_FILE_NAME)),
        )
        .await?;
    let document_id = created.document_id().to_string();

    match insert_instructions_document_with_stale_cleanup(&ctx, user_id, &document_id).await {
        Ok(()) => Ok(Json(CreateInstructionsDocumentResponse { document_id })),
        Err(error) => {
            ctx.documents_state
                .service
                .cleanup_created_document(&document_id)
                .await;
            Err(error)
        }
    }
}

async fn insert_instructions_document_with_stale_cleanup(
    ctx: &ApiContext,
    user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
    document_id: &str,
) -> Result<(), DocumentError> {
    match insert_instructions_document(&ctx.db, user_id.clone(), document_id).await {
        Ok(()) => Ok(()),
        Err(CreateInstructionsError::UserAlreadyHasInstructions) => {
            if get_instructions_document(&ctx.db, user_id.clone())
                .await
                .map_err(DocumentError::Internal)?
                .is_some()
            {
                return Err(DocumentError::Conflict(
                    "User already has an instructions document".to_string(),
                ));
            }

            sqlx::query!(
                r#"DELETE FROM "InstructionsDocuments" WHERE "userId" = $1"#,
                user_id.as_ref()
            )
            .execute(&ctx.db)
            .await
            .map_err(|error| DocumentError::Internal(error.into()))?;

            insert_instructions_document(&ctx.db, user_id, document_id)
                .await
                .map_err(|error| DocumentError::Internal(anyhow::anyhow!(error)))
        }
        Err(error) => Err(DocumentError::Internal(anyhow::anyhow!(error))),
    }
}
