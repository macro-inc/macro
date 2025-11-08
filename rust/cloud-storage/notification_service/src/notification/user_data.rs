use model_notifications::{Notification, NotificationWithRecipient, UserNotification};

// convert the Notification object from a single generic notification to a list of user-specific
// notifications that may have different values depending on the user.
pub async fn populate_user_data(
    notification: Notification,
    user_ids: &[String],
    is_important: bool,
) -> Vec<NotificationWithRecipient> {
    // Determine importance and create new notification object
    let notifications: Vec<NotificationWithRecipient> = user_ids
        .iter()
        .map(|user_id| NotificationWithRecipient {
            inner: UserNotification::from_new_notification(
                notification.clone(),
                is_important,
                false,
                false,
            ),
            recipient_id: user_id.to_string(),
            is_important_v0: is_important,
        })
        .collect();

    notifications
}
