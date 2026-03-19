use crate::{InviteToTeamMetadata, NewEmailMetadata};
use notification::domain::models::email_notification_digest::{
    EmailBlockList, NotificationSetBuilder,
};
use referral_invitation::InviteToMacro;

/// define a blocklist of notification types which will never be templated into a digest email
pub fn digest_email_block_list() -> EmailBlockList {
    EmailBlockList::new::<NewEmailMetadata>()
        .append::<InviteToTeamMetadata>()
        .append::<InviteToMacro>()
}
