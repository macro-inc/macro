use crate::api::context::ApiContext;
use crate::model::ws::{StreamError, WebSocketError};
use anyhow::Result;
use macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2;
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;

#[tracing::instrument(
    err,
    skip(ctx),
    fields(
        user_id = %user_ctx.user_id,
        chat_id = %chat_id,
        stream_id = %stream_id,
    )
)]
pub async fn chat_access(
    ctx: &ApiContext,
    user_ctx: &UserContext,
    chat_id: &str,
    stream_id: String,
) -> Result<AccessLevel, WebSocketError> {
    get_users_access_level_v2(
        &ctx.db,
        &ctx.comms_service_client,
        &user_ctx.user_id,
        chat_id,
        "chat",
    )
    .await
    .map_err(|e| {
        tracing::error!(
            error = ?e,
            "Failed to get user access level"
        );
        WebSocketError::StreamError(StreamError::Unauthorized {
            stream_id: stream_id.clone(),
        })
    })
    .and_then(|access| match access {
        Some(access) => Ok(access),
        None => {
            tracing::error!("User has no access to chat");
            Err(WebSocketError::StreamError(StreamError::Unauthorized {
                stream_id,
            }))
        }
    })
}
