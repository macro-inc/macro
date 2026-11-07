use super::{NotificationTitle, alert_apns};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use notification::domain::models::apple::{
    APNSPushNotification, PushNotificationData, PushNotificationNavigation,
};
use uuid::Uuid;

#[cfg(test)]
mod test;

pub(super) fn channel_apns<T: NotificationTitle>(
    notification: &T,
    sender_id: Option<MacroUserIdStr<'_>>,
    notification_id: Uuid,
    sender_profile_picture_url: Option<String>,
    entity: &Entity<'_>,
    message_id: &str,
    thread_id: Option<&str>,
) -> Option<APNSPushNotification<PushNotificationData>> {
    let mut apns = alert_apns(
        notification,
        sender_id,
        notification_id,
        sender_profile_picture_url,
    )
    .ok()?;
    // Old persisted metadata can contain invalid IDs. Keep its alert and let the
    // client resolve the notification record instead of emitting a broken route.
    apns.push_notification_data.navigation = (|| {
        if entity.entity_type != EntityType::Channel {
            return None;
        }
        Some(PushNotificationNavigation::Channel {
            channel_id: Uuid::parse_str(&entity.entity_id).ok()?,
            message_id: Uuid::parse_str(message_id).ok()?,
            thread_id: thread_id.map(Uuid::parse_str).transpose().ok()?,
        })
    })();
    Some(apns)
}
