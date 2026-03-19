use crate::NewEmailMetadata;
use notification::domain::models::email_notification_digest::{
    EmailBlockList, NotificationSetBuilder,
};

pub fn digest_email_block_list() -> EmailBlockList {
    EmailBlockList::new::<NewEmailMetadata>()
}
