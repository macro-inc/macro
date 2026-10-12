use crate::{ColleagueJoinedMacro, InviteToTeamMetadata, ItemImportedMetadata, NewEmailMetadata};
use invite_email::InviteToMacro;
use notification::domain::models::email_notification_digest::{
    EmailBlockList, NotificationSetBuilder,
};

#[cfg(test)]
mod test;

/// define a blocklist of notification types which will never be templated into a digest email
pub fn digest_email_block_list() -> EmailBlockList {
    EmailBlockList::new::<NewEmailMetadata>()
        .append::<InviteToTeamMetadata>()
        .append::<InviteToMacro>()
        .append::<invite_email::CallInvite>()
        .append::<ColleagueJoinedMacro>()
        // Imports notify the importing user about their own work, in bulk.
        .append::<ItemImportedMetadata>()
}
