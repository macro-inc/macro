use super::*;
use crate::ChannelMentionMetadata;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use notification::domain::models::{Notification, NotificationState, UserNotificationRow};
use std::sync::Arc;

fn row_of<T: Notification>() -> UserNotificationRow<Arc<()>> {
    UserNotificationRow {
        owner_id: MacroUserIdStr::try_from_email("bob@acme.com").unwrap(),
        notification_id: uuid::Uuid::nil(),
        notification_event_type: T::TYPE_NAME.to_string(),
        entity: EntityType::Team.with_entity_str("11111111-1111-1111-1111-111111111111"),
        sent: false,
        state: NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: Arc::new(()),
        sender_id: None,
    }
}

#[test]
fn colleague_joined_macro_never_lands_in_a_digest() {
    let block_list = digest_email_block_list();
    assert!(
        block_list
            .notification_is_allowed(row_of::<ColleagueJoinedMacro>())
            .is_right()
    );
    assert!(
        block_list
            .notification_is_allowed(row_of::<ChannelMentionMetadata>())
            .is_left()
    );
}
