//! Mobile push notification models for SNS delivery.

use serde::{Deserialize, Serialize, Serializer};
use sha2::{Digest, Sha256};

use crate::domain::models::{
    android::FCMMessage,
    apple::{APNSPushNotification, Alert, VoipPushPayload},
};

/// SNS target platform for push notifications.
#[derive(Debug)]
pub enum SnsTarget<'a, T> {
    /// iOS target via APNS.
    Ios(&'a APNSPushNotification<T>),
    /// iOS VoIP target via APNS_VOIP.
    Voip(&'a VoipPushPayload),
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
    /// Android payload with GCM key.
    Android {
        /// Default message text.
        default: String,
        /// FCM payload.
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
            SnsTarget::Voip(payload) => format!("Incoming call in {}", payload.channel_name),
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
            SnsTarget::Voip(payload) => SnsPayload::Voip {
                default: self.default_string(),
                apns_voip: payload,
                apns_voip_sandbox: payload,
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

/// Used to build up the data to construct a [`HashedCollapseKey`].
///
/// Uses SHA-256 internally for stable hashing across Rust compiler versions.
pub struct NotifCollapseKey(Sha256);

/// Contains the string representation of a notification collapse key.
/// This is used to uniquely identify notifications delivered to an iOS device.
#[derive(Debug, Clone)]
pub struct HashedCollapseKey(String);

impl AsRef<str> for HashedCollapseKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl HashedCollapseKey {
    /// Create from an already-hashed string.
    pub fn from_hashed(s: String) -> Self {
        Self(s)
    }

    /// Consume and return the inner string.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl NotifCollapseKey {
    /// Create a new collapse key seeded with the given string.
    pub fn new(s: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(s.as_bytes());
        NotifCollapseKey(hasher)
    }

    /// Append additional data to the collapse key.
    pub fn append(mut self, s: &str) -> Self {
        self.0.update(s.as_bytes());
        self
    }

    /// Finalize the key into a hex-encoded SHA-256 hash string.
    pub fn into_hashed(self) -> HashedCollapseKey {
        let hash = self.0.finalize();
        HashedCollapseKey(hex::encode(hash))
    }
}

/// APNS message attributes for SNS delivery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageAttributes {
    /// The push notification type (alert or background).
    pub push_type: PushType,
    /// The collapse key for grouping/replacing notifications.
    pub collapse_key: String,
}

/// The type of push notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PushType {
    /// Background/silent notification.
    Background,
    /// Alert notification with visible content.
    Alert,
}

/// A device endpoint for push notifications.
#[derive(Debug, Clone)]
pub enum DeviceEndpoint {
    /// Android device endpoint (FCM).
    Android(String),
    /// iOS device endpoint (APNS).
    Ios(String),
    /// iOS VoIP device endpoint (APNS_VOIP / PushKit).
    IosVoip(String),
}
