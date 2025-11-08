use crate::model::response::chats::GetChatPermissionsResponseV2;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::chat::ChatAccessLevelExtractor;
use model::user::UserContext;
use models_permissions::share_permission::access_level::EditAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub chat_id: String,
}

/// Gets the current chat share permissions
#[utoipa::path(
        get,
        path = "/v2/chats/{chat_id}/permissions",
        responses(
            (status = 200, body=GetChatPermissionsResponseV2),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params( ("chat_id" = String, Path, description = "id of the chat"))
    )]
#[allow(dead_code, unused_variables)]
pub(in crate::api) async fn get_chat_permissions_handler_v2(
    user_context: Extension<UserContext>,
    Path(Params { chat_id }): Path<Params>,
) -> impl IntoResponse {
    // TODO: implement
    StatusCode::OK
}

#[tracing::instrument(skip(db, _access), fields(user_id=?_user_context.user_id))]
pub async fn get_chat_permissions_handler(
    _access: ChatAccessLevelExtractor<EditAccessLevel>,
    State(db): State<PgPool>,
    _user_context: Extension<UserContext>,
    Path(Params { chat_id }): Path<Params>,
) -> impl IntoResponse {
    get_chat_permissions_v2(&db, &chat_id).await
}

#[tracing::instrument(skip(db))]
async fn get_chat_permissions_v2(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
) -> Result<Response, Response> {
    let chat_permissions =
        macro_db_client::share_permission::get::get_chat_share_permission(db, chat_id)
            .await
            .map_err(|e| {
                tracing::error!(error = ?e, chat_id, "Failed to fetch chat share permission");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to get chat permissions",
                )
                    .into_response()
            })?;

    let res = GetChatPermissionsResponseV2 {
        permissions: chat_permissions,
    };

    Ok((StatusCode::OK, Json(res)).into_response())
}
