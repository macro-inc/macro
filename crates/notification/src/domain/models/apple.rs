//! Apple Push Notification Service (APNS) payload models.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The APNS payload container.
#[derive(Serialize, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct Aps {
    /// The alert content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert: Option<Alert>,

    /// The badge number to display on the app icon.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<u32>,

    /// The notification sound.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<Sound>,

    /// Set to 1 for background/silent notifications.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_available: Option<u8>,

    /// Set to 1 to allow Notification Service Extension to modify.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutable_content: Option<u8>,

    /// Category identifier for actionable notifications.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,

    /// Identifier for grouping notifications.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,

    /// Relevance score for notification summary (0.0 to 1.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance_score: Option<f64>,

    /// Interruption level: passive, active, time-sensitive, critical.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_level: Option<InterruptionLevel>,
}

impl Default for Aps {
    fn default() -> Self {
        Self {
            alert: Default::default(),
            badge: Default::default(),
            // default to sending the default ios sound (which also controls vibration)
            sound: Some(Sound::Default("default".to_string())),
            content_available: Default::default(),
            mutable_content: Default::default(),
            category: Default::default(),
            thread_id: Default::default(),
            relevance_score: Default::default(),
            interruption_level: Default::default(),
        }
    }
}

/// The alert content of an APNS notification.
#[derive(Serialize, Debug, Deserialize)]
#[serde(untagged)]
pub enum Alert {
    /// A simple string alert.
    Simple(String),
    /// A dictionary-based alert with title, body, etc.
    Dictionary(AlertDictionary),
}

/// Dictionary-based alert with structured fields.
#[derive(Serialize, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct AlertDictionary {
    /// The title of the notification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// The subtitle of the notification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,

    /// The body text of the notification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,

    /// Localization key for title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_loc_key: Option<String>,

    /// Localization arguments for title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_loc_args: Option<Vec<String>>,

    /// Localization key for body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_key: Option<String>,

    /// Localization arguments for body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_args: Option<Vec<String>>,

    /// Custom launch image filename.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_image: Option<String>,
}

/// Notification sound configuration.
#[derive(Serialize, Debug, Deserialize)]
#[serde(untagged)]
pub enum Sound {
    /// Default sound (usually "default").
    Default(String),
    /// Critical sound with volume control.
    Critical(CriticalSound),
}

/// Critical sound configuration with volume control.
#[derive(Serialize, Debug, Deserialize)]
pub struct CriticalSound {
    /// Set to 1 for critical sound.
    pub critical: u8,
    /// Sound file name.
    pub name: String,
    /// Volume level (0.0 to 1.0).
    pub volume: f64,
}

/// The interruption level of a notification.
#[derive(Serialize, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InterruptionLevel {
    /// Delivered silently.
    Passive,
    /// Default behavior.
    Active,
    /// Can break through Focus modes.
    TimeSensitive,
    /// Highest priority, requires entitlement.
    Critical,
}

/// A complete APNS push notification with custom data.
#[derive(Serialize, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct APNSPushNotification<T> {
    /// The APNS payload.
    pub aps: Aps,

    /// Custom data payload to send to the client.
    /// This data has no effect on 'how' the notification is delivered.
    #[serde(flatten)]
    pub push_notification_data: T,
}

/// Empty `aps` object required by SNS APNS_VOIP payload validation.
///
/// SNS rejects VoIP push messages that lack an `aps` key, even though Apple
/// passes the full payload verbatim to `pushRegistry(_:didReceiveIncomingPushWith:)`
/// regardless of whether `aps` is present.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct VoipAps {}

/// Payload for a VoIP push notification (PushKit / CallKit).
///
/// SNS's APNS_VOIP validator requires an `aps` key to be present; the value is
/// an empty object and has no effect on delivery or the PushKit delegate payload.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoipPushPayload {
    /// Required by SNS APNS_VOIP validation; empty at the Apple level.
    pub aps: VoipAps,
    /// UUID string that identifies the call (used as the CallKit call UUID).
    pub call_id: String,
    /// Channel ID that the call belongs to.
    pub channel_id: String,
    /// Human-readable channel name displayed in the CallKit sheet.
    pub channel_name: String,
    /// Display name of the caller shown in the CallKit incoming-call UI.
    pub caller_name: String,
    /// LiveKit websocket URL for native lock-screen answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub livekit_server_url: Option<String>,
    /// Recipient-specific LiveKit JWT for native lock-screen answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub livekit_token: Option<String>,
    /// Absolute URL the native client polls while ringing to learn whether
    /// the call was answered elsewhere or ended. Authenticated with
    /// `livekit_token` as the bearer credential.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ring_status_url: Option<String>,
}

/// the value we send as the payload in the ios notification
/// This data is accessible to the client
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PushNotificationData {
    /// The id of the notification record (UserNotification.id)
    pub notification_id: Uuid,
    /// The sender's profile picture URL, used by the Notification Service Extension
    /// to download and attach as a rich notification image.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}
