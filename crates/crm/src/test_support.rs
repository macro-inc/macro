//! Fakes shared by the crate's database tests.

use entity_access::domain::models::EntityType as AccessEntityType;
use macro_user_id::user_id::MacroUserIdStr;
use properties::domain::model::TaskAssignedNotification;
use properties::domain::model::{EditReceipt, ViewReceipt};
use properties::{NotificationService, PermissionService};

/// Properties permission checks no test reaches.
pub(crate) struct NoPermissions;

impl PermissionService for NoPermissions {
    type Err = anyhow::Error;

    async fn mint_view_receipt<'a>(
        &self,
        _user_id: Option<&'a MacroUserIdStr<'a>>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<ViewReceipt, Self::Err> {
        unimplemented!("tests never mint view receipts")
    }

    async fn mint_edit_receipt<'a>(
        &self,
        _user_id: &MacroUserIdStr<'a>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<EditReceipt, Self::Err> {
        unimplemented!("tests never mint edit receipts")
    }

    async fn grant_permissions_to_task<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
        _task_id: &str,
    ) -> Result<(), Self::Err> {
        unimplemented!("tests never grant task permissions")
    }
}

/// Properties notifications no test sends.
pub(crate) struct NoNotifications;

impl NotificationService for NoNotifications {
    type Err = anyhow::Error;

    async fn send_task_assigned<'a>(
        &self,
        _notification: TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        unimplemented!("tests never notify")
    }
}
