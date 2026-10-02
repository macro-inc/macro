//! Sharing by explicit channel grants over `SharePermissionV2`; databases
//! have no share link or team share, and refuse turning either on.

use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};

use super::models::{DatabaseError, DatabaseId};

/// Persistence of direct channel grants, implemented through the owning access crate.
pub trait DatabaseSharingRepo: Send + Sync + 'static {
    /// Persistence failure.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Read the direct channel grants for a database.
    fn channel_grants(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Vec<ChannelSharePermission>, Self::Error>> + Send;

    /// Change channel grants only while the database remains live.
    fn update_channel_grants(
        &self,
        database_id: DatabaseId,
        grants: &[UpdateChannelSharePermission],
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;
}

/// Owners control the database's recipients and each recipient's access level.
pub trait DatabaseSharingService: Send + Sync + 'static {
    /// Read sharing details after proving ownership.
    fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<SharePermissionV2, DatabaseError>> + Send;

    /// Update explicit channel grants without modifying ownership.
    fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> impl Future<Output = Result<SharePermissionV2, DatabaseError>> + Send;
}
