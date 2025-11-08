use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
#[allow(unused_imports)]
use futures::stream::TryStreamExt;
use macro_middleware::cloud_storage::ensure_access::chat::ChatAccessLevelExtractor;
use model::chat::ChatBasic;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use model::user::UserContext;
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct Params {
    pub chat_id: String,
}

/// Deletes a specific document
#[utoipa::path(
        tag = "chat",
        put,
        operation_id = "revert_delete_chat",
        path = "/chats/{chat_id}/revert_delete",
        params(
            ("chat_id" = String, Path, description = "Chat ID")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context, chat_context, _access), fields(user_id=?user_context.user_id))]
pub async fn handler(
    _access: ChatAccessLevelExtractor<OwnerAccessLevel>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    chat_context: Extension<ChatBasic>,
    Path(Params { chat_id }): Path<Params>,
) -> impl IntoResponse {
    tracing::trace!("revert_delete document");

    if let Err(e) = macro_db_client::chat::revert_delete::revert_delete_chat(
        &db,
        &chat_id,
        chat_context.project_id.as_deref(),
    )
    .await
    {
        tracing::error!(error = %e, chat_id = %chat_id, project_id = ?chat_context.project_id, "Failed to revert chat deletion");
        return GenericResponse::builder()
            .message("unable to revert chat")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let response_data = GenericSuccessResponse { success: true };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
