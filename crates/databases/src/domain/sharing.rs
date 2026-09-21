//! Sharing uses the same explicit channel grants as other collaboration entities.

use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use serde::Serialize;

use super::models::{DatabaseError, DatabaseId};

/// Recipient grants shown in the native sharing interface.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSharePermissions {
    /// Database identifier; sharing has no separate policy entity.
    #[schema(value_type = String, format = Uuid)]
    pub id: DatabaseId,
    /// Current database owner.
    pub owner: String,
    /// Directly shared channels, including direct messages.
    pub channel_share_permissions: Vec<ChannelSharePermission>,
}

/// Persistence of direct channel grants, implemented through the owning access crate.
pub trait DatabaseSharingRepo: Send + Sync + 'static {
    /// Persistence failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Read the direct channel grants for a database.
    fn channel_grants(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Vec<ChannelSharePermission>, Self::Err>> + Send;

    /// Change channel grants only while the database remains live.
    fn update_channel_grants(
        &self,
        database_id: DatabaseId,
        grants: &[UpdateChannelSharePermission],
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Owners control the database's recipients and each recipient's access level.
pub trait DatabaseSharingService: Send + Sync + 'static {
    /// Read sharing details after proving ownership.
    fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<DatabaseSharePermissions, DatabaseError>> + Send;

    /// Update explicit channel grants without modifying ownership.
    fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        grants: Vec<UpdateChannelSharePermission>,
    ) -> impl Future<Output = Result<DatabaseSharePermissions, DatabaseError>> + Send;
}
