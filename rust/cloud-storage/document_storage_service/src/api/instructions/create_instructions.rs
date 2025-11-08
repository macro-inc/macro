use crate::{
    api::context::ApiContext, model::response::instructions::CreateInstructionsDocumentResponse,
};
use axum::{Extension, Json, extract::State, http::StatusCode, response::IntoResponse};
use macro_db_client::instructions::create::CreateInstructionsError;
use model::{
    response::{GenericErrorResponse, GenericResponse},
    user::UserContext,
};

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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn create_instructions_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    // Create the instructions document - database handles uniqueness constraint
    match macro_db_client::instructions::create::create_instructions_document(
        &ctx.db,
        &user_context.user_id,
    )
    .await
    {
        Ok(document_id) => {
            let response_data = CreateInstructionsDocumentResponse { document_id };
            (StatusCode::OK, Json(response_data)).into_response()
        }
        Err(CreateInstructionsError::UserAlreadyHasInstructions) => GenericResponse::builder()
            .message("User already has an instructions document")
            .is_error(true)
            .send(StatusCode::CONFLICT),
        Err(CreateInstructionsError::DatabaseError(err)) => {
            tracing::error!(error=?err, user_id=?user_context.user_id, "failed to create instructions document");
            GenericResponse::builder()
                .message("Failed to create instructions document")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
