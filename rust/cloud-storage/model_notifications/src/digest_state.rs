use crate::{InviteToTeamMetadata, NewEmailMetadata};
use notification::domain::models::email_notification_digest::{
    EmailBlockList, ExplicitInviteAllowList, NotificationSetBuilder,
};

pub fn common_email_block_list() -> EmailBlockList {
    EmailBlockList::new::<NewEmailMetadata>()
}

pub fn common_explicit_invite_allow_list() -> ExplicitInviteAllowList {
    ExplicitInviteAllowList::new::<InviteToTeamMetadata>()
}
