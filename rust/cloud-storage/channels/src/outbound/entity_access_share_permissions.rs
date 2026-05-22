//! Entity-access adapter for channel share-permission side effects.

use crate::domain::ports::ChannelSharePermissionService;
use anyhow::Context;
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{
    access_level::AccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};
use share_permission_db_utils::InsertChannelSharePermissionResult;
use sqlx::PgPool;
use std::{str::FromStr, sync::Arc};
use uuid::Uuid;

/// Entity-access backed share permission updater.
#[derive(Clone)]
pub struct EntityAccessChannelSharePermissions<E> {
    pool: PgPool,
    entity_access_service: Arc<E>,
}

impl<E> EntityAccessChannelSharePermissions<E> {
    /// Create a share permission adapter.
    pub fn new(pool: PgPool, entity_access_service: Arc<E>) -> Self {
        Self {
            pool,
            entity_access_service,
        }
    }
}

impl<E> ChannelSharePermissionService for EntityAccessChannelSharePermissions<E>
where
    E: EntityAccessService,
{
    type Err = anyhow::Error;

    async fn update_channel_share_permissions(
        &self,
        user_id: String,
        channel_id: Uuid,
        items: Vec<(String, String)>,
    ) -> Result<(), Self::Err> {
        for (item_id, item_type) in items {
            update_channel_share_permission(
                &self.pool,
                &*self.entity_access_service,
                &user_id,
                &channel_id.to_string(),
                &item_id,
                &item_type,
            )
            .await?;
        }
        Ok(())
    }
}

async fn update_channel_share_permission(
    db: &PgPool,
    entity_access_service: &impl EntityAccessService,
    user_id: &str,
    channel_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    let entity_id = macro_uuid::string_to_uuid(item_id)?;

    if model::item::ShareableItemType::from_str(item_type).is_err() {
        return Ok(());
    }

    if item_type == "thread" {
        share_permission_db_utils::ensure_thread_share_permission(db, item_id)
            .await
            .context("failed to insert thread share permissions")?;
    }

    let entity_type = match item_type {
        "document" => EntityType::Document,
        "chat" => EntityType::Chat,
        "project" => EntityType::Project,
        "thread" => EntityType::EmailThread,
        "call" => EntityType::Call,
        _ => anyhow::bail!("unsupported item type: {}", item_type),
    };

    let user_id = MacroUserIdStr::parse_from_str(user_id).context("invalid user id")?;
    let user_access_level = entity_access_service
        .get_access_level(Some(&user_id), item_id, entity_type)
        .await
        .context("failed to get user access level")?;

    if user_access_level.is_none() {
        tracing::info!("user does not have access to the item, not modifying share permissions");
        return Ok(());
    }

    let channel_share_permission_access_level = AccessLevel::View;
    let share_permission_id =
        share_permission_db_utils::get_share_permission_id(db, item_id, item_type)
            .await
            .context("failed to get share permission id")?;

    let mut transaction = db.begin().await?;
    let insert_result = share_permission_db_utils::insert_channel_share_permission(
        &mut *transaction,
        &share_permission_id,
        channel_id,
        channel_share_permission_access_level,
    )
    .await
    .context("failed to insert channel share permission")?;

    if insert_result == InsertChannelSharePermissionResult::AlreadyExists {
        return Ok(());
    }

    entity_access_db_utils::update_entity_access_channel_share_permissions(
        &mut transaction,
        &entity_id,
        entity_type,
        &[UpdateChannelSharePermission {
            channel_id: channel_id.to_string(),
            operation: UpdateOperation::Add,
            access_level: Some(channel_share_permission_access_level),
        }],
    )
    .await
    .context("failed to update channel entity access")?;

    transaction.commit().await?;
    Ok(())
}
