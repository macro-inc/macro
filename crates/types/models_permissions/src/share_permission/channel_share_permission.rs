use crate::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The channel share permission
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "snake_case")]
pub struct ChannelSharePermission {
    /// The channel id
    pub channel_id: String,
    /// The access level for the channel
    pub access_level: AccessLevel,
}

impl ChannelSharePermission {
    pub fn get_max<'a>(&'a self, other: &'a Self) -> &'a Self {
        if self.access_level > other.access_level {
            self
        } else {
            other
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChannelSharePermission {
    /// The type of operation to be performed on the chanel share permission
    /// You can add, remove or replace and existing permission
    pub operation: UpdateOperation,
    /// The channel id
    pub channel_id: String,
    /// The access level for the channel
    /// This is required if the operation is add or replace
    pub access_level: Option<AccessLevel>,
}

impl From<&UpdateChannelSharePermission> for ChannelSharePermission {
    fn from(val: &UpdateChannelSharePermission) -> Self {
        ChannelSharePermission {
            channel_id: val.channel_id.clone(),
            access_level: val.access_level.unwrap_or(AccessLevel::View),
        }
    }
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, ToSchema, Copy, Clone)]
#[serde(rename_all = "lowercase")]
pub enum UpdateOperation {
    Add,
    Remove,
    Replace,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "snake_case")]
pub struct ChannelSharePermissionRow {
    /// The channel id
    pub channel_id: String,
    /// The share_permission_id associated with the row
    pub share_permission_id: String,
    /// The access level for the channel
    pub access_level: AccessLevel,
}
