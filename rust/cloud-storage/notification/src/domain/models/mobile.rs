use serde::{Serialize, Serializer};

use crate::domain::models::{
    android::FCMMessage,
    apple::{APNSPushNotification, Alert},
};

#[derive(Debug)]
pub enum SnsTarget<T> {
    Ios(Box<APNSPushNotification<T>>),
    Android(FCMMessage<T>),
}

#[derive(Debug, Serialize)]
#[serde(bound = "T: Serialize", untagged)]
pub enum SnsPayload<'a, T> {
    Ios {
        default: String,
        #[serde(rename = "APNS", serialize_with = "stringified_json")]
        apns: &'a APNSPushNotification<T>,
        #[serde(rename = "APNS_SANDBOX", serialize_with = "stringified_json")]
        apns_sandbox: &'a APNSPushNotification<T>,
    },
    Android {
        default: String,
        #[serde(rename = "GCM", serialize_with = "stringified_json")]
        gcm: &'a FCMMessage<T>,
    },
}

fn stringified_json<T, S>(val: &T, ser: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
    T: Serialize,
{
    let s = serde_json::to_string(val).expect("json serialize cant fail");
    ser.serialize_str(&s)
}

impl<'a, T> SnsPayload<'a, T>
where
    T: Serialize,
{
    fn as_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

impl<T> SnsTarget<T> {
    fn default_string(&self) -> String {
        match self {
            SnsTarget::Ios(apnspush_notification) => apnspush_notification
                .aps
                .alert
                .as_ref()
                .and_then(|a| match a {
                    Alert::Simple(s) => Some(s.clone()),
                    Alert::Dictionary(alert_dictionary) => alert_dictionary.title.clone(),
                })
                .unwrap_or(String::new()),
            SnsTarget::Android(fcmmessage) => fcmmessage.android.notification.clone(),
        }
    }
    fn as_payload(&self) -> SnsPayload<'_, T> {
        match self {
            SnsTarget::Ios(apnspush_notification) => SnsPayload::Ios {
                default: self.default_string(),
                apns: apnspush_notification,
                apns_sandbox: apnspush_notification,
            },
            SnsTarget::Android(fcmmessage) => SnsPayload::Android {
                default: self.default_string(),
                gcm: fcmmessage,
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct MessageAttributes {
    pub push_type: PushType,
    pub collapse_key: String,
}

#[derive(Debug, Clone)]
pub enum PushType {
    Background,
    Alert,
}

impl PushType {
    fn as_static_str(&self) -> &'static str {
        match self {
            PushType::Background => "background",
            PushType::Alert => "alert",
        }
    }
}
