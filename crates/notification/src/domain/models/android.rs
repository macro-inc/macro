//! Android push notification models (FCM via SNS).

use serde::Serialize;

/// FCM push notification message for Android devices.
#[derive(Debug, Serialize)]
pub struct FCMMessage<T> {
    pub(crate) android: AndroidData,
    data: T,
}

impl<T> FCMMessage<T> {
    /// temporary method since android is currently out of scope for mobile
    /// this just instantiates a majority blank notif
    pub fn new_temporary_empty(data: T) -> Self {
        FCMMessage {
            android: AndroidData {
                notification: "Temporary placeholder".to_string(),
                priority: AndroidNotifPrio::Normal,
                collapse_key: String::new(),
            },
            data,
        }
    }
}

/// Android notification priority level.
#[derive(Debug, Serialize)]
pub enum AndroidNotifPrio {
    /// Normal priority.
    Normal,
    /// High priority.
    High,
}

/// Android FCM notification data.
#[derive(Debug, Serialize)]
pub struct AndroidData {
    pub(crate) notification: String,
    pub(crate) priority: AndroidNotifPrio,
    pub(crate) collapse_key: String,
}
