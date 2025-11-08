use crate::item::{ShareableItem, UserAccessibleItem};
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct UpdateChannelSharePermissionRequest {
    /// The id of the channel to add/remove from the share permissions
    pub channel_id: String,
    /// The user who initiated the update
    pub user_id: String,
    /// The item id
    pub item_id: String,
    /// The item type
    pub item_type: String,
    /// The type of the channel
    /// The valid channel types are: direct_message, private, organization, public
    pub channel_type: String,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct UpdateUserChannelPermissionsRequest {
    /// The users to add/remove perms for
    pub user_ids: Vec<String>,
    /// The channel id
    pub channel_id: String,
    /// The operation we are performing for the user
    pub operation: UpdateOperation,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct GetItemIDsResponse {
    pub items: Vec<UserAccessibleItem>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct ValidateItemIDsRequest {
    /// The list of items to validate
    pub items: Vec<ShareableItem>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct ValidateItemIDsResponse {
    /// The list of items that the user has access to
    /// This list is generated from the items provided in the request
    pub items: Vec<UserAccessibleItem>,
}

/// Request payload for batch document metadata retrieval
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct GetDocumentsMetadataRequest {
    pub document_ids: Vec<String>,
}

/// Response data for document metadata
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct GetDocumentsMetadataResponse {
    pub documents: Vec<DocumentMetadata>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct DocumentMetadata {
    pub item_id: String,
    pub item_name: String,
    pub item_owner: String,
    pub file_type: Option<String>,
}
