//! Device registration models.

use serde::{Deserialize, Serialize};
use sqlx::Type;
use strum::{Display, EnumString};

/// The device platform type.
#[derive(Debug, Clone, Serialize, Deserialize, Type, EnumString, Display, Eq, PartialEq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
#[sqlx(
    type_name = "notification_device_type_option",
    rename_all = "lowercase"
)]
#[strum(serialize_all = "lowercase")]
pub enum DeviceType {
    /// iOS (APNS).
    Ios,
    /// Android (FCM).
    Android,
    /// iOS VoIP (PushKit / CallKit). Uses the APNS_VOIP SNS platform application.
    #[serde(rename = "iosvoip")]
    #[sqlx(rename = "iosvoip")]
    #[strum(serialize = "iosvoip")]
    IosVoip,
}

/// Request to register or unregister a device for push notifications.
#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DeviceRequest {
    /// The device platform type (iOS or Android).
    pub device_type: DeviceType,
    /// The device push notification token.
    pub token: String,
}
