use serde::{Deserialize, Serialize};

use crate::domain::models::Notification;

#[derive(Serialize, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct Aps {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert: Option<Alert>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<Sound>,

    /// Set to 1 for background/silent notifications
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_available: Option<u8>,

    /// Set to 1 to allow Notification Service Extension to modify
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutable_content: Option<u8>,

    /// Category identifier for actionable notifications
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,

    /// Identifier for grouping notifications
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,

    /// Relevance score for notification summary (0.0 to 1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance_score: Option<f64>,

    /// Interruption level: passive, active, time-sensitive, critical
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_level: Option<InterruptionLevel>,
}

#[derive(Serialize, Debug, Deserialize)]
#[serde(untagged)]
pub enum Alert {
    Simple(String),
    Dictionary(AlertDictionary),
}

#[derive(Serialize, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct AlertDictionary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,

    /// Localization key for title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_loc_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_loc_args: Option<Vec<String>>,

    /// Localization key for body
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_args: Option<Vec<String>>,

    /// Custom launch image filename
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_image: Option<String>,
}

#[derive(Serialize, Debug, Deserialize)]
#[serde(untagged)]
pub enum Sound {
    Default(String), // Usually "default"
    Critical(CriticalSound),
}

#[derive(Serialize, Debug, Deserialize)]
pub struct CriticalSound {
    pub critical: u8, // 1 for critical
    pub name: String,
    pub volume: f64, // 0.0 to 1.0
}

#[derive(Serialize, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InterruptionLevel {
    Passive,
    Active,
    TimeSensitive,
    Critical,
}

#[derive(Serialize, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct APNSPushNotification<T> {
    pub aps: Aps,

    /// custom data payload to send to the client.
    /// This data has no effect on 'how' the notification is delivered
    #[serde(flatten)]
    pub push_notification_data: T,
}

impl APNSPushNotification<()> {
    /// construct a simple apple notification using the input notifications title and body
    pub fn default_new<T: Notification>(notif: &T) -> Self {
        APNSPushNotification {
            aps: Aps {
                alert: Some(Alert::Dictionary(AlertDictionary {
                    title: Some(notif.title()),
                    body: Some(notif.body()),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: (),
        }
    }
}
