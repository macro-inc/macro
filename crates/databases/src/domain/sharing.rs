//! Sharing over `SharePermissionV2`: explicit channel grants and a team share
//! with the owner's team, both through the canonical entity-access writers.
//! Databases have no share link and refuse turning one on.

use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts,
};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};

use super::models::{DatabaseError, DatabaseId};

/// What a sharing write did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharingWrite {
    /// The grants and team share were written.
    Written,
    /// The database is trashed or gone; nothing was written.
    Gone,
    /// Ownership, team membership or the team share changed since the
    /// change was authorized; nothing was written.
    Changed,
}

/// Persistence of channel grants and the team share, implemented through
/// the owning access crates.
pub trait DatabaseSharingRepo: Send + Sync + 'static {
    /// Persistence failure.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Read the direct channel grants for a database.
    fn channel_grants(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Vec<ChannelSharePermission>, Self::Error>> + Send;

    /// The level the database is shared with its owner's team at, if it is.
    fn team_share_level(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Option<AccessLevel>, Self::Error>> + Send;

    /// The actual owner, their team and the team share, for authorizing a change.
    fn team_share_facts(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<TeamShareFacts, Self::Error>> + Send;

    /// Change channel grants and the team share together, only while the
    /// database remains live and the team facts are unchanged.
    fn update_sharing(
        &self,
        database_id: DatabaseId,
        grants: &[UpdateChannelSharePermission],
        team_share: Option<&AuthorizedTeamShareCommand>,
    ) -> impl Future<Output = Result<SharingWrite, Self::Error>> + Send;
}

/// Owners control the database's recipients and each recipient's access level.
pub trait DatabaseSharingService: Send + Sync + 'static {
    /// Read sharing details after proving ownership.
    fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<SharePermissionV2, DatabaseError>> + Send;

    /// Update channel grants and the team share without modifying ownership.
    fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> impl Future<Output = Result<SharePermissionV2, DatabaseError>> + Send;
}
