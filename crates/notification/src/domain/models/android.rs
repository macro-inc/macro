//! Android push notification content.

use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;

/// Content for an Android push. The outbound adapter encodes the FCM transport.
#[derive(Debug, Serialize)]
pub struct FCMMessage<T> {
    /// Intended account, checked by the device before display or navigation.
    pub recipient_id: MacroUserIdStr<'static>,
    /// Visible title, absent for a notification-clear command.
    pub title: Option<String>,
    /// Visible body, absent for a notification-clear command.
    pub body: Option<String>,
    /// Stable identifier used to replace or clear the displayed notification.
    pub identifier: String,
    /// Client metadata, including the notification ID used for tap navigation.
    pub data: T,
}

impl<T> FCMMessage<T> {
    /// Create a visible Android notification.
    pub fn notification(
        title: String,
        body: String,
        identifier: String,
        data: T,
        recipient_id: MacroUserIdStr<'static>,
    ) -> Self {
        Self {
            recipient_id,
            title: Some(title),
            body: Some(body),
            identifier,
            data,
        }
    }

    /// Clear a previously displayed notification without displaying an alert.
    pub fn clear(identifier: String, data: T, recipient_id: MacroUserIdStr<'static>) -> Self {
        Self {
            recipient_id,
            title: None,
            body: None,
            identifier,
            data,
        }
    }
}
