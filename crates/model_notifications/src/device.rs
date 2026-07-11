use serde::{Deserialize, Serialize};
use sqlx::Type;
use strum::{Display, EnumString};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema, Type, EnumString, Display, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
#[sqlx(
    type_name = "notification_device_type_option",
    rename_all = "lowercase"
)]
#[strum(serialize_all = "lowercase")]
pub enum DeviceType {
    Ios,
    Android,
    /// iOS VoIP device (PushKit / CallKit). Registered and delivered via the
    /// APNS_VOIP SNS platform application — separate from the regular APNS one.
    #[serde(rename = "iosvoip")]
    #[sqlx(rename = "iosvoip")]
    #[strum(serialize = "iosvoip")]
    IosVoip,
}
