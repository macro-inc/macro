use serde::{Deserialize, Serialize};
use sqlx::Type;
use strum::{Display, EnumString};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema, Type, EnumString, Display, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "device_type_option", rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum DeviceType {
    Ios,
    Android,
}
