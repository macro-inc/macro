use crate::api::context::ApiContext;
use anyhow::Result;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model::user::UserContext;
use model_entity::EntityType;
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
    let user_id = MacroUserIdStr::parse_from_str(&user_ctx.user_id)
        .map_err(|e| anyhow::anyhow!("Failed to parse user_id: {e}"))?;
    ctx.entity_access_service
        .get_access_level(Some(&user_id), chat_id, EntityType::Chat)
        .await
        .map_err(|e| anyhow::anyhow!(e))
        .and_then(|access| match access {
            Some(access) => Ok(access),
            None => Err(anyhow::anyhow!("No Access")),
        })
}
