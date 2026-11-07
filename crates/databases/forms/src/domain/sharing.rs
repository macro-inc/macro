//! Sharing a form by explicit channel grants over `SharePermissionV2`, as a
//! database is: no share link or team share. A form's public audience is
//! its own setting, not a share.

use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};

use super::models::{FormError, FormId};

/// Persistence of a form's direct channel grants, through the owning access
/// crate.
pub trait FormSharingRepo: Send + Sync + 'static {
    /// Persistence failure.
    type Error: std::error::Error + Send + Sync + 'static;

    /// The form's direct channel grants.
    fn channel_grants(
        &self,
        form_id: FormId,
    ) -> impl Future<Output = Result<Vec<ChannelSharePermission>, Self::Error>> + Send;

    /// Change channel grants while the form is live; `false` when it is
    /// gone or trashed.
    fn update_channel_grants(
        &self,
        form_id: FormId,
        grants: &[UpdateChannelSharePermission],
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;
}

/// Owners control who a form is shared with and at what level.
pub trait FormSharingService: Send + Sync + 'static {
    /// The form's recipients, after proving ownership.
    fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<SharePermissionV2, FormError>> + Send;

    /// Change the form's channel grants without changing its owner.
    fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> impl Future<Output = Result<SharePermissionV2, FormError>> + Send;
}
