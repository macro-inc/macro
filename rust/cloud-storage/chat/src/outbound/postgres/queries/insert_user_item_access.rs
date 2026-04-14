//! Grant a user access to a chat.

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_entity_access_management::EntityAccessSourceType;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Postgres, Transaction};

/// Insert an access record granting the user the given access level on a chat.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn insert_user_item_access(
    tx: &mut Transaction<'_, Postgres>,
    user_id: MacroUserIdStr<'_>,
    chat_id: &uuid::Uuid,
    access_level: AccessLevel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "entity_access" (
            "entity_id",
            "entity_type",
            "source_id",
            "source_type",
            "access_level"
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
        chat_id,
        EntityType::Chat.as_ref(),
        user_id.as_ref(),
        EntityAccessSourceType::User as _,
        access_level as _,
    )
    .execute(tx.as_mut())
    .await?;

    Ok(())
}
