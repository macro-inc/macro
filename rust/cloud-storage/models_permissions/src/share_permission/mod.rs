use crate::share_permission::access_level::AccessLevel;
use crate::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use utoipa::ToSchema;

pub mod access_level;
pub mod channel_share_permission;
pub mod user_permission;

/// Default value for is public for DSS items excluding projects
pub static IS_PUBLIC_DEFAULT: bool = true;
/// Default value for public access level for DSS items excluding projects
/// Should we ever update IS_PUBLIC_DEFAULT to false, we should set this to None
pub static PUBLIC_ACCESS_LEVEL_DEFAULT: Option<AccessLevel> = Some(AccessLevel::View);
pub static IS_PUBLIC_DEFAULT_PROJECT: bool = false;
pub static PUBLIC_ACCESS_LEVEL_DEFAULT_PROJECT: Option<AccessLevel> = None;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharePermissionV2 {
    /// The share permission id
    pub id: String,
    /// If the item is publicly accessible
    pub is_public: bool,
    /// The level of public access
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_access_level: Option<AccessLevel>,
    /// The owner of the item
    pub owner: String,
    /// The channel share permissions for the item
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_share_permissions: Option<Vec<ChannelSharePermission>>,
}

impl Default for SharePermissionV2 {
    fn default() -> Self {
        SharePermissionV2 {
            id: "".to_string(),
            is_public: IS_PUBLIC_DEFAULT,
            public_access_level: PUBLIC_ACCESS_LEVEL_DEFAULT,
            owner: "".to_string(),
            channel_share_permissions: None,
        }
    }
}

impl SharePermissionV2 {
    pub fn new(is_public: Option<bool>, public_access_level: Option<AccessLevel>) -> Self {
        SharePermissionV2 {
            id: "".to_string(),
            is_public: is_public.unwrap_or(IS_PUBLIC_DEFAULT),
            public_access_level,
            owner: "".to_string(),
            channel_share_permissions: None,
        }
    }

    pub fn default_project() -> Self {
        SharePermissionV2 {
            id: "".to_string(),
            is_public: IS_PUBLIC_DEFAULT_PROJECT,
            public_access_level: PUBLIC_ACCESS_LEVEL_DEFAULT_PROJECT,
            owner: "".to_string(),
            channel_share_permissions: None,
        }
    }

    pub fn user_only() -> Self {
        SharePermissionV2 {
            id: "".to_string(),
            is_public: false,
            public_access_level: None,
            owner: "".to_string(),
            channel_share_permissions: None,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSharePermissionRequestV2 {
    /// If the item is publicly accessible
    pub is_public: Option<bool>,
    /// The level of public access
    pub public_access_level: Option<AccessLevel>,
    /// Any channel share permissions to be created/updated/removed
    pub channel_share_permissions: Option<Vec<UpdateChannelSharePermission>>,
}
