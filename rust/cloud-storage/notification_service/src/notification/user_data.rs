use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::{Notification, NotificationWithRecipient, UserNotification};
use std::collections::HashMap;

// convert the Notification object from a single generic notification to a list of user-specific
// notifications that may have different values depending on the user.
pub fn populate_user_data(
    notification: Notification,
    user_ids: &[MacroUserIdStr<'static>],
) -> HashMap<MacroUserIdStr<'static>, Vec<NotificationWithRecipient>> {
    // Determine importance and create new notification object
    user_ids
        .iter()
        .map(|user_id| {
            (
                user_id.clone(),
                vec![NotificationWithRecipient {
                    inner: UserNotification::from_new_notification(
                        notification.clone(),
                        false,
                        false,
                    ),
                    recipient_id: user_id.clone(),
                }],
            )
        })
        .collect()
}
