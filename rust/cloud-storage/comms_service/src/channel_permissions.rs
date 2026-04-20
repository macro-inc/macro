//! Channel share permissions handling.
//!
//! This module contains the logic for managing channel share permissions,
//! which was previously handled via calls to the document storage service.

use anyhow::Context;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::PgPool;
use std::str::FromStr;

/// Updates the channel share permission for an item shared in a channel message.
///
/// When a user shares an item (document, chat, project, thread) in a channel message,
/// this function:
/// 1. Validates the user has access to the item
/// 2. Creates a channel share permission linking the item to the channel
/// 3. Grants all channel participants view access to the item
#[tracing::instrument(skip(db, entity_access_service), err)]
pub async fn update_channel_share_permission(
    db: &PgPool,
    entity_access_service: &impl EntityAccessService,
    user_id: &str,
    channel_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    // The item id should be a uuid
    let entity_id = macro_uuid::string_to_uuid(item_id)?;

    // If the item type is not a supported shareable item type, return success early
    if model::item::ShareableItemType::from_str(item_type).is_err() {
        return Ok(());
    }

    // TODO: we should make everything here use the transaction
    let mut transaction = db.begin().await?;

    // Ensure thread share permissions exist before getting access level
    if item_type == "thread" {
        macro_middleware::cloud_storage::thread::ensure_thread_exists::insert_thread_share_permissions(db, item_id)
            .await
            .context("failed to insert thread share permissions")?;
    }

    // Map item_type string to EntityType
    let entity_type = match item_type {
        "document" => EntityType::Document,
        "chat" => EntityType::Chat,
        "project" => EntityType::Project,
        "thread" => EntityType::EmailThread,
        "call" => EntityType::Call,
        _ => anyhow::bail!("unsupported item type: {}", item_type),
    };

    // Parse user_id
    let user_id_parsed = MacroUserIdStr::parse_from_str(user_id).context("invalid user id")?;

    // Get user's max access level to the item
    let user_access_level = entity_access_service
        .get_access_level(Some(&user_id_parsed), item_id, entity_type)
        .await
        .context("failed to get user access level")?;

    if user_access_level.is_none() {
        tracing::info!("user does not have access to the item, not modifying share permissions");
        return Ok(());
    }

    let channel_share_permission_access_level = AccessLevel::View;

    // Get share permission id
    let share_permission_id =
        macro_db_client::share_permission::get::get_share_permission_id(db, item_id, item_type)
            .await
            .context("failed to get share permission id")?;

    // Insert channel share permission
    if let Err(e) =
        macro_db_client::share_permission::channel_permission::create::insert_channel_share_permission(
            db,
            &share_permission_id,
            channel_id,
            &channel_share_permission_access_level,
        )
        .await
    {
        if e.to_string() == "channel permission already exists" {
            // fail silently. this flow happens when the patch item call made by the FE inserts the CSP
            // before this.
            return Ok(());
        } else {
            return Err(e).context("failed to insert channel share permission");
        }
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
    .await?;

    Ok(())
}
