use crate::share_permission::access_level::AccessLevel;
use crate::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use model_file_type::FileType;
use utoipa::ToSchema;
pub mod access_level;
pub mod channel_share_permission;
pub mod user_permission;

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

impl SharePermissionV2 {
    fn new(is_public: bool, public_access_level: Option<AccessLevel>) -> Self {
        SharePermissionV2 {
            id: "".to_string(),
            is_public,
            public_access_level,
            owner: "".to_string(),
            channel_share_permissions: None,
        }
    }

    /// Creates a new share permission object for a document
    pub fn new_document_share_permission(file_type: Option<FileType>) -> Self {
        let (is_public, public_access_level) = match file_type {
            Some(FileType::Md) => (true, Some(AccessLevel::Edit)),
            _ => (false, None),
        };

        Self::new(is_public, public_access_level)
    }

    /// Creates a new share permission object for an ai chat
    pub fn new_chat_share_permission() -> Self {
        Self::new(false, None)
    }

    /// Creates a new share permission object for a project
    pub fn new_project_share_permission() -> Self {
        Self::new(false, None)
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
