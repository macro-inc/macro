//! Which items a realtime change may affect.
//!
//! Triggers only name candidate keys; the service recomputes those items
//! from storage, so a trigger that names an item outside the feed costs one
//! lookup and changes nothing.

use model_entity::{Entity, EntityType};
use model_notifications::NotifEvent;
use notification::domain::models::UserNotificationRow;

use super::stacking::channel_thread_root;

#[cfg(test)]
mod test;

/// The items a notification about its entity may affect. A channel
/// notification can move between the channel item and a thread item, so
/// both are recomputed; a plain send names the thread it may root.
pub fn notification_trigger_keys(
    notification: &UserNotificationRow<NotifEvent>,
) -> Vec<Entity<'static>> {
    let mut keys = vec![notification.entity.clone()];
    if notification.entity.entity_type != EntityType::Channel {
        return keys;
    }
    let thread = channel_thread_root(notification).or(match &notification.notification_metadata {
        NotifEvent::ChannelMessageSend(send) => Some(send.message_id.as_str()),
        _ => None,
    });
    if let Some(root) = thread {
        keys.push(EntityType::ChannelMessage.with_entity_string(root.to_string()));
    }
    keys
}
