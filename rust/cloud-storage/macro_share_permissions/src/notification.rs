use std::str::FromStr;

use anyhow::Context;
use model_entity::EntityType;
use model_notifications::{
    ItemSharedMetadata, ItemSharedOrganizationMetadata, NotificationEntity, NotificationEvent,
    NotificationQueueMessage,
};

#[derive(Debug)]
pub struct ItemShareNotifications {
    pub user_notification: Option<NotificationQueueMessage>,
    pub org_notification: Option<NotificationQueueMessage>,
}

//NOTE: @syneot - This seems to be unused ???

/// Generates a share notification event to be sent to notification queue
/// Returns two notifcaitons (<individual_user_notification>, <organization_notification>)
pub fn create_notifications_from_item_shared(
    item_id: &str,             // The id of the item that was shared
    item_type: &str,           // The type of the item that was shared
    item_name: Option<String>, // The name/title of the shared item
    user_id: &str,             // The user id that performed the edit
    // The user ids that were added to the share permission
    user_ids: &[String],
    // The user ids that were added to the organization share permission
    org_user_ids: &[String],
    permission_level: Option<String>, // Permission level granted
) -> anyhow::Result<ItemShareNotifications> {
    let entity_type = EntityType::from_str(item_type).context("Failed to parse entity type")?;

    let build_message =
        |recipients: &[String], event_type: NotificationEvent| -> NotificationQueueMessage {
            NotificationQueueMessage {
                notification_entity: NotificationEntity {
                    event_item_id: item_id.to_string(),
                    event_item_type: entity_type,
                },
                notification_event: event_type,
                sender_id: Some(user_id.to_string()),
                recipient_ids: Some(recipients.to_vec()),
                is_important_v0: Some(false),
            }
        };

    let user_notification = if !user_ids.is_empty() {
        let metadata = ItemSharedMetadata {
            user_ids: user_ids.to_vec(),
            item_type: entity_type,
            item_id: item_id.to_string(),
            item_name: item_name.clone(),
            shared_by: user_id.to_string(),
            permission_level: permission_level.clone(),
        };

        Some(build_message(
            user_ids,
            NotificationEvent::ItemSharedUser(metadata),
        ))
    } else {
        None
    };

    let org_notification = if !org_user_ids.is_empty() {
        let metadata = ItemSharedOrganizationMetadata {
            org_user_ids: org_user_ids.to_vec(),
            item_type: entity_type,
            item_id: item_id.to_string(),
            item_name,
            shared_by: user_id.to_string(),
            permission_level,
        };
        Some(build_message(
            user_ids,
            NotificationEvent::ItemSharedOrganization(metadata),
        ))
    } else {
        None
    };

    Ok(ItemShareNotifications {
        user_notification,
        org_notification,
    })
}
