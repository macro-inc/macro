use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::domain::models::apple::APNSPushNotification;

pub(crate) mod android;
pub(crate) mod apple;
pub(crate) mod mobile;

#[derive(Debug, Serialize, Deserialize)]
struct NotificationPayload<'a, T> {
    /// some arbitraty T which implements [Notification]
    notification: T,
    /// the entity for which the notification is associated
    notification_entity: Entity<'a>,
    /// the sender id of the user
    sender: Option<MacroUserIdStr<'a>>,
    /// the recipient ids of the notification
    recipients: Vec<MacroUserIdStr<'a>>,
}

pub trait Notification: Serialize + DeserializeOwned {
    const TYPE_NAME: &'static str;

    fn title(&self) -> String;
    fn body(&self) -> String;
}

pub trait BuildApnsNotification<T>: Notification {
    fn build_apns(&self) -> APNSPushNotification<T>;
}

#[derive(Debug, Clone)]
pub enum DeviceEndpoint {
    Android(String),
    Ios(String),
}

impl DeviceEndpoint {
    pub fn arn(&self) -> &str {
        match self {
            DeviceEndpoint::Android(a) => a.as_ref(),
            DeviceEndpoint::Ios(i) => i.as_ref(),
        }
    }
}

struct MobileNotification<'a, T> {
    payload: NotificationPayload<'a, T>,
    device_endpoint: DeviceEndpoint,
}
