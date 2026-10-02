//! SNS wire payloads. Platform transport details stay in the outbound adapter.

use crate::domain::models::{
    android::FCMMessage,
    apple::{APNSPushNotification, Alert, VoipPushPayload},
};
use serde::{Serialize, Serializer};

#[cfg(test)]
mod test;

/// SNS target platform for push notifications.
#[derive(Debug)]
pub enum SnsTarget<'a, T> {
    /// iOS target via APNS.
    Ios(&'a APNSPushNotification<T>),
    /// iOS VoIP target via APNS_VOIP.
    Voip(&'a VoipPushPayload),
    /// Data-only, short-lived Android incoming-call push and its recipient.
    AndroidCall(&'a VoipPushPayload, &'a str),
    /// Android target via FCM.
    Android(&'a FCMMessage<T>),
}

/// SNS payload formatted for platform-specific delivery.
#[derive(Debug, Serialize)]
#[serde(bound = "T: Serialize", untagged)]
pub(crate) enum SnsPayload<'a, T> {
    /// iOS payload with APNS and APNS_SANDBOX keys.
    Ios {
        /// Default message text.
        default: String,
        /// Production APNS payload.
        #[serde(rename = "APNS", serialize_with = "stringified_json")]
        apns: &'a APNSPushNotification<T>,
        /// Sandbox APNS payload.
        #[serde(rename = "APNS_SANDBOX", serialize_with = "stringified_json")]
        apns_sandbox: &'a APNSPushNotification<T>,
    },
    /// iOS VoIP payload with APNS_VOIP and APNS_VOIP_SANDBOX keys.
    Voip {
        /// Default message text.
        default: String,
        /// Production APNS VoIP payload.
        #[serde(rename = "APNS_VOIP", serialize_with = "stringified_json")]
        apns_voip: &'a VoipPushPayload,
        /// Sandbox APNS VoIP payload.
        #[serde(rename = "APNS_VOIP_SANDBOX", serialize_with = "stringified_json")]
        apns_voip_sandbox: &'a VoipPushPayload,
    },
    /// Android incoming-call payload.
    AndroidCall {
        /// Default message text.
        default: String,
        /// FCM v1 envelope, serialized as an SNS platform string.
        #[serde(rename = "GCM", serialize_with = "stringified_json")]
        gcm: serde_json::Value,
    },
    /// Android payload with GCM key.
    Android {
        /// Default message text.
        default: String,
        /// FCM payload.
        #[serde(rename = "GCM", serialize_with = "stringified_fcm_json")]
        gcm: &'a FCMMessage<T>,
    },
}

fn stringified_json<T, S>(val: &T, ser: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
    T: Serialize,
{
    let s = serde_json::to_string(val).map_err(serde::ser::Error::custom)?;
    ser.serialize_str(&s)
}

fn stringified_fcm_json<T: Serialize, S: Serializer>(
    notification: &FCMMessage<T>,
    ser: S,
) -> Result<S::Ok, S::Error> {
    // FCM data values must all be strings. Keep arbitrary client metadata in
    // one JSON string rather than flattening nested objects into the data map.
    let payload = serde_json::to_string(&notification.data).map_err(serde::ser::Error::custom)?;
    let visible = notification.title.is_some() || notification.body.is_some();
    let mut data = std::collections::BTreeMap::from([
        (
            "type",
            if visible { "notification" } else { "clear" }.to_owned(),
        ),
        ("identifier", notification.identifier.clone()),
        ("recipientId", notification.recipient_id.to_string()),
        ("payload", payload),
    ]);
    if let Some(title) = &notification.title {
        data.insert("title", title.clone());
    }
    if let Some(body) = &notification.body {
        data.insert("body", body.clone());
    }

    // Data-only messages reach the native receive handler in foreground and
    // background, giving it one owner for display, deduplication, and clearing.
    let message = serde_json::json!({
        "fcmV1Message": {
            "message": {
                "android": { "priority": if visible { "high" } else { "normal" } },
                "data": data,
            }
        }
    });
    stringified_json(&message, ser)
}

impl<'a, T> SnsPayload<'a, T>
where
    T: Serialize,
{
    fn as_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

impl<T> SnsTarget<'_, T> {
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
            SnsTarget::Voip(payload) | SnsTarget::AndroidCall(payload, _) => {
                format!("Incoming call in {}", payload.channel_name)
            }
            SnsTarget::Android(fcmmessage) => fcmmessage.title.clone().unwrap_or_default(),
        }
    }

    fn as_payload(&self) -> SnsPayload<'_, T> {
        match self {
            SnsTarget::Ios(apnspush_notification) => SnsPayload::Ios {
                default: self.default_string(),
                apns: apnspush_notification,
                apns_sandbox: apnspush_notification,
            },
            SnsTarget::Voip(payload) => SnsPayload::Voip {
                default: self.default_string(),
                apns_voip: payload,
                apns_voip_sandbox: payload,
            },
            SnsTarget::AndroidCall(payload, recipient) => SnsPayload::AndroidCall {
                default: self.default_string(),
                gcm: serde_json::json!({"fcmV1Message": {"message": {
                    "android": {"priority": "high", "ttl": "60s"},
                    "data": {"type": "call", "recipientId": recipient,
                        "payload": serde_json::to_string(payload).expect("call payload serializes")}
                }}}),
            },
            SnsTarget::Android(fcmmessage) => SnsPayload::Android {
                default: self.default_string(),
                gcm: fcmmessage,
            },
        }
    }
}

impl<T: Serialize> SnsTarget<'_, T> {
    /// Serialize the target to JSON for SNS.
    pub fn as_json(&self) -> Result<String, serde_json::Error> {
        self.as_payload().as_json()
    }
}
