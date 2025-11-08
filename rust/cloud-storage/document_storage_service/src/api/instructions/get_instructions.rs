use crate::{
    api::context::ApiContext, model::response::instructions::GetInstructionsDocumentResponse,
};
use axum::{Extension, Json, extract::State, http::StatusCode, response::IntoResponse};
use model::{
    response::{GenericErrorResponse, GenericResponse},
    user::UserContext,
};

/// Gets the instructions document for the current user
#[utoipa::path(
    get,
    path = "/instructions",
    responses(
        (status = 200, body = GetInstructionsDocumentResponse),
        (status = 401, body = GenericErrorResponse),
        (status = 404, body = GenericErrorResponse, description = "User does not have an instructions document"),
        (status = 500, body = GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_instructions_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    match macro_db_client::instructions::get::get_instructions_document(
        &ctx.db,
        &user_context.user_id,
    )
    .await
    {
        Ok(Some(document_id)) => {
            let response_data = GetInstructionsDocumentResponse { document_id };
            (StatusCode::OK, Json(response_data)).into_response()
        }
        Ok(None) => GenericResponse::builder()
            .message("User does not have an instructions document")
            .is_error(true)
            .send(StatusCode::NOT_FOUND),
        Err(err) => {
            tracing::error!(error=?err, user_id=?user_context.user_id, "failed to get instructions document");
            GenericResponse::builder()
                .message("Failed to get instructions document")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
