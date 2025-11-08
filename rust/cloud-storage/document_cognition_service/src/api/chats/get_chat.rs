use crate::{
    api::context::ApiContext, model::response::chats::GetChatResponse, service::get_chat::get_chat,
};
use ai::types::Role;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_middleware::cloud_storage::ensure_access::chat::ChatAccessLevelExtractor;
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use std::sync::Arc;

#[derive(serde::Deserialize)]
pub struct Params {
    pub chat_id: String,
}

/// Gets a particular chat by its id
#[utoipa::path(
        get,
        path = "/chats/{chat_id}",
        responses(
            (status = 200, body=GetChatResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params( ("chat_id" = String, Path, description = "id of the chat"))
    )]
#[tracing::instrument(skip(ctx, user_context, access_level), fields(user_id=?user_context.user_id))]
pub async fn get_chat_handler(
    ChatAccessLevelExtractor { access_level, .. }: ChatAccessLevelExtractor<ViewAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { chat_id }): Path<Params>,
) -> impl IntoResponse {
    let mut chat = match get_chat(&Arc::new(ctx.clone()), &chat_id, &user_context.user_id).await {
        Ok(chat) => chat,
        Err(err) => {
            let mut status_code = StatusCode::INTERNAL_SERVER_ERROR;
            if err
                .to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                status_code = StatusCode::NOT_FOUND;
            }
            tracing::error!(
                error = %err,
                chat_id = %chat_id,
                user_id = %user_context.user_id,
                status_code = ?status_code,
                "failed to get chat"
            );
            return Err((status_code, "unable to get chat permissions"));
        }
    };

    chat.messages.retain(|m| m.role != Role::System);

    let get_chat_response = GetChatResponse {
        chat,
        user_access_level: access_level,
    };

    Ok((StatusCode::OK, Json(get_chat_response)))
}
