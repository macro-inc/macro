use crate::api::context::ApiContext;
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
) -> Result<AccessLevel> {
    get_users_access_level_v2(&ctx.db, &user_ctx.user_id, chat_id, "chat")
        .await
        .map_err(|e| anyhow::anyhow!(e.1))
        .and_then(|access| match access {
            Some(access) => Ok(access),
            None => Err(anyhow::anyhow!("No Access")),
        })
}
