//! Postgres adapter for channel reference share-permission side effects.

use crate::domain::{
    models::{ReferencedShareItem, ReferencedShareItemType},
    ports::ChannelReferenceSharePermissions,
};
use anyhow::Context;
use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{
    access_level::AccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};
use share_permission_db_utils::InsertChannelSharePermissionResult;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

/// Postgres-backed share-permission adapter for channel message references.
#[derive(Clone)]
pub struct PgChannelReferenceSharePermissions<E> {
    pool: PgPool,
    entity_access_service: Arc<E>,
}

impl<E> PgChannelReferenceSharePermissions<E> {
    /// Create a Postgres-backed reference share-permission adapter.
    pub fn new(pool: PgPool, entity_access_service: Arc<E>) -> Self {
        Self {
            pool,
            entity_access_service,
        }
    }
}

impl<E> ChannelReferenceSharePermissions for PgChannelReferenceSharePermissions<E>
where
    E: EntityAccessService,
{
    type Err = anyhow::Error;

    async fn update_channel_share_permissions_for_referenced_items(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        items: Vec<ReferencedShareItem>,
    ) -> Result<(), Self::Err> {
        for item in items {
            ensure_referenced_item_visible_to_channel(
                &self.pool,
                &*self.entity_access_service,
                &actor,
                channel_id,
                &item,
            )
            .await?;
        }

        Ok(())
    }
}

async fn ensure_referenced_item_visible_to_channel(
    db: &PgPool,
    entity_access_service: &impl EntityAccessService,
    actor: &MacroUserIdStr<'_>,
    channel_id: Uuid,
    item: &ReferencedShareItem,
) -> anyhow::Result<()> {
    let entity_id = macro_uuid::string_to_uuid(item.entity_id())?;

    if item.entity_type() == ReferencedShareItemType::EmailThread {
        share_permission_db_utils::ensure_thread_share_permission(db, item.entity_id())
            .await
            .context("failed to insert thread share permissions")?;
    }

    let entity_type = entity_access_type_for(item.entity_type());
    let user_access_level = entity_access_service
        .get_access_level(Some(actor), item.entity_id(), entity_type)
        .await
        .context("failed to get user access level")?;

    if user_access_level.is_none() {
        tracing::info!(
            item_id = item.entity_id(),
            item_type = item.entity_type().as_str(),
            "user does not have access to the item, not modifying share permissions"
        );
        return Ok(());
    }

    let share_permission_id = share_permission_db_utils::get_share_permission_id(
        db,
        item.entity_id(),
        item.entity_type().as_str(),
    )
    .await
    .context("failed to get share permission id")?;

    let mut transaction = db.begin().await?;
    let insert_result = share_permission_db_utils::insert_channel_share_permission(
        &mut *transaction,
        &share_permission_id,
        &channel_id.to_string(),
        AccessLevel::View,
    )
    .await
    .context("failed to insert channel share permission")?;

    if insert_result == InsertChannelSharePermissionResult::AlreadyExists {
        return Ok(());
    }

    entity_access_db_utils::update_entity_access_channel_share_permissions(
        &mut transaction,
        &entity_id,
        entity_access_db_type_for(item.entity_type()),
        &[UpdateChannelSharePermission {
            channel_id: channel_id.to_string(),
            operation: UpdateOperation::Add,
            access_level: Some(AccessLevel::View),
        }],
    )
    .await
    .context("failed to update channel entity access")?;

    transaction.commit().await?;
    Ok(())
}

fn entity_access_type_for(item_type: ReferencedShareItemType) -> EntityType {
    match item_type {
        ReferencedShareItemType::Document => EntityType::Document,
        ReferencedShareItemType::Chat => EntityType::Chat,
        ReferencedShareItemType::Project => EntityType::Project,
        ReferencedShareItemType::EmailThread => EntityType::EmailThread,
        ReferencedShareItemType::Call => EntityType::Call,
    }
}

fn entity_access_db_type_for(
    item_type: ReferencedShareItemType,
) -> entity_access_db_utils::EntityType {
    match item_type {
        ReferencedShareItemType::Document => entity_access_db_utils::EntityType::Document,
        ReferencedShareItemType::Chat => entity_access_db_utils::EntityType::Chat,
        ReferencedShareItemType::Project => entity_access_db_utils::EntityType::Project,
        ReferencedShareItemType::EmailThread => entity_access_db_utils::EntityType::EmailThread,
        ReferencedShareItemType::Call => entity_access_db_utils::EntityType::Call,
    }
}
