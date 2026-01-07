use serde::{Deserialize, Serialize};
use sqlx::Type;
use strum::Display;
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, ToSchema, Display)]
#[sqlx(type_name = "comms_channel_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ChannelType {
    Public,
    Organization,
    Private,
    DirectMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMetadata {
    pub name: String,
    pub channel_type: ChannelType,
}

impl From<(String, ChannelType)> for ChannelMetadata {
    fn from((name, channel_type): (String, ChannelType)) -> Self {
        Self { name, channel_type }
    }
}
