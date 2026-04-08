//! Channel share permissions handling.
//!
//! This module contains the logic for managing channel share permissions,
//! which was previously handled via calls to the document storage service.

use anyhow::Context;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::user_item_access::UserItemAccess;
use sqlx::PgPool;
use std::str::FromStr;
use uuid::Uuid;

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
    // If the item type is not a supported shareable item type, return success early
    if model::item::ShareableItemType::from_str(item_type).is_err() {
        return Ok(());
    }

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
        "channel" => EntityType::Channel,
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

    // This flow means the channel share permission is new - the user shared the item directly
    // through a channel message. Grant all channel participants view access.
    let channel_uuid = Uuid::parse_str(channel_id).context("failed to parse channel_id as UUID")?;

    let channel_participants =
        comms_db_client::participants::get_participants::get_participants(db, &channel_uuid)
            .await
            .context("failed to get channel participants")?
            .into_iter()
            .filter_map(|p| match p.left_at {
                // If the user left we should not update their user item access
                Some(_) => None,
                None => Some(p.user_id),
            })
            .collect::<Vec<_>>();

    macro_db_client::item_access::insert::upsert_user_item_access_bulk(
        db,
        &channel_participants,
        item_id,
        item_type,
        channel_share_permission_access_level,
        Some(channel_uuid),
    )
    .await
    .context("failed to insert user item access rows")?;

    Ok(())
}

/// Adds permissions for users who have been added to a channel.
///
/// When users are added to a channel, they need to be granted access to all items
/// that have been shared with that channel.
#[tracing::instrument(skip(db))]
pub async fn add_permissions_for_channel_users(
    db: &PgPool,
    channel_id: &str,
    user_ids: &[String],
) -> anyhow::Result<()> {
    if user_ids.is_empty() {
        return Ok(());
    }

    let channel_uuid =
        macro_uuid::string_to_uuid(channel_id).context("failed to parse channel_id as UUID")?;

    let mut items_to_insert: Vec<UserItemAccess> = Vec::new();

    // Get all channel share permissions for the channel
    let csps = macro_db_client::share_permission::channel_permission::get::get_channel_share_permissions_by_channel_id(
        db,
        channel_id,
    )
    .await
    .context("failed to get channel share permissions for channel")?;

    let csp_ids = csps
        .iter()
        .map(|csp| csp.share_permission_id.clone())
        .collect::<Vec<_>>();

    if csp_ids.is_empty() {
        return Ok(());
    }

    // Get all items matching the channel share permission IDs
    let item_type_map =
        macro_db_client::share_permission::get::get_items_by_share_permission_ids(db, &csp_ids)
            .await
            .context("failed to get items for share permission ids")?;

    // For each item, add an entry for each user into UserItemAccess
    for csp in csps {
        if let Some((item_id, item_type)) = item_type_map.get(&csp.share_permission_id) {
            for user_id in user_ids.iter() {
                items_to_insert.push(UserItemAccess {
                    id: macro_uuid::generate_uuid_v7(),
                    user_id: user_id.to_string(),
                    item_id: item_id.to_string(),
                    item_type: item_type.to_string(),
                    access_level: csp.access_level,
                    granted_from_channel_id: Some(channel_uuid),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                });
            }
        }
    }

    if !items_to_insert.is_empty() {
        // Insert into database
        macro_db_client::item_access::insert::insert_user_item_access_batch(db, &items_to_insert)
            .await
            .context("failed to insert user item access records")?;
    }

    Ok(())
}

/// Removes permissions for users who have been removed from a channel.
///
/// When users are removed from a channel, their access to items granted through
/// that channel should be revoked.
#[tracing::instrument(skip(db))]
pub async fn remove_permissions_for_channel_users(
    db: &PgPool,
    channel_id: &str,
    user_ids: &[String],
) -> anyhow::Result<u64> {
    if user_ids.is_empty() {
        return Ok(0);
    }

    let channel_uuid =
        macro_uuid::string_to_uuid(channel_id).context("failed to parse channel_id as UUID")?;

    // Delete all UserItemAccess records for these users granted from this channel
    let rows_affected =
        macro_db_client::item_access::delete::delete_user_item_access_by_channel_and_users(
            db,
            channel_uuid,
            user_ids,
        )
        .await
        .context("failed to delete user item access records")?;

    Ok(rows_affected)
}
