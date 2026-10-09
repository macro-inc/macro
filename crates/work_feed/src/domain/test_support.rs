//! Notification fixtures shared by the domain tests.

use std::sync::Arc;

use chrono::{DateTime, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::NotifEvent;
use notification::domain::models::{NotificationState, UserNotificationRow};
use serde_json::{Value, json};
use uuid::Uuid;

use super::models::FeedNotification;

pub(crate) const USER: &str = "macro|viewer@example.com";

/// A minute past 10:00 on 2024-06-01, UTC.
pub(crate) fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2024, 6, 1, 10, minute, 0).unwrap()
}

pub(crate) fn viewer_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).unwrap()
}

pub(crate) fn uuid(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

pub(crate) fn entity(entity_type: EntityType, id: u128) -> Entity<'static> {
    entity_type.with_entity_string(uuid(id).to_string())
}

/// A notification with typed metadata decoded from `tag`/`content`, the way
/// stored rows are.
pub(crate) fn notification(
    id: u128,
    entity: Entity<'static>,
    tag: &str,
    content: Value,
    minute: u32,
    state: NotificationState,
) -> FeedNotification {
    let metadata: NotifEvent = serde_json::from_value(json!({ "tag": tag, "content": content }))
        .unwrap_or_else(|error| panic!("invalid {tag} fixture: {error}"));
    Arc::new(UserNotificationRow {
        owner_id: viewer_id(),
        notification_id: uuid(id),
        notification_event_type: tag.to_string(),
        entity,
        sent: true,
        state,
        created_at: at(minute),
        viewed_at: None,
        updated_at: at(minute),
        deleted_at: None,
        notification_metadata: metadata,
        sender_id: None,
    })
}

pub(crate) fn channel_send(
    id: u128,
    channel: u128,
    message: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_message_send",
        json!({ "messageId": uuid(message), "messageContent": "hi", "channelType": "public" }),
        minute,
        NotificationState::Unseen,
    )
}

pub(crate) fn channel_reply(
    id: u128,
    channel: u128,
    thread: u128,
    message: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_message_reply",
        json!({
            "threadId": uuid(thread),
            "messageId": uuid(message),
            "messageContent": "re",
            "channelType": "public",
        }),
        minute,
        NotificationState::Unseen,
    )
}

pub(crate) fn channel_mention(
    id: u128,
    channel: u128,
    message: u128,
    thread: Option<u128>,
    minute: u32,
) -> FeedNotification {
    let mut content = json!({
        "messageId": uuid(message),
        "messageContent": "@you",
        "channelType": "public",
    });
    if let Some(thread) = thread {
        content["threadId"] = json!(uuid(thread));
    }
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_mention",
        content,
        minute,
        NotificationState::Unseen,
    )
}

pub(crate) fn channel_reaction(
    id: u128,
    channel: u128,
    message: u128,
    thread: Option<u128>,
    minute: u32,
) -> FeedNotification {
    let mut content = json!({
        "messageId": uuid(message),
        "messageContent": "nice",
        "emoji": "+1",
        "channelType": "public",
    });
    if let Some(thread) = thread {
        content["threadId"] = json!(uuid(thread));
    }
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_message_reaction",
        content,
        minute,
        NotificationState::Unseen,
    )
}

pub(crate) fn channel_invite(id: u128, channel: u128, minute: u32) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_invite",
        json!({ "invitedBy": USER, "channelType": "public" }),
        minute,
        NotificationState::Unseen,
    )
}

fn comment_content(comment: u128, thread: u128) -> Value {
    json!({
        "documentName": "Doc",
        "owner": USER,
        "commentId": uuid(comment),
        "threadId": uuid(thread),
        "text": "comment",
    })
}

pub(crate) fn doc_comment(
    id: u128,
    document: u128,
    comment: u128,
    thread: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Document, document),
        "commented_on_document",
        comment_content(comment, thread),
        minute,
        NotificationState::Unseen,
    )
}

pub(crate) fn doc_reply(
    id: u128,
    document: u128,
    comment: u128,
    thread: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Document, document),
        "replied_to_document_comment_thread",
        comment_content(comment, thread),
        minute,
        NotificationState::Unseen,
    )
}

pub(crate) fn doc_comment_mention(
    id: u128,
    document: u128,
    comment: u128,
    thread: u128,
    minute: u32,
) -> FeedNotification {
    let mut content = comment_content(comment, thread);
    content["mentionId"] = json!("mention");
    notification(
        id,
        entity(EntityType::Document, document),
        "mentioned_in_document_comment",
        content,
        minute,
        NotificationState::Unseen,
    )
}

pub(crate) fn reminder(id: u128, entity: Entity<'static>, minute: u32) -> FeedNotification {
    notification(
        id,
        entity,
        "reminder",
        json!({ "reminderId": uuid(id), "description": "follow up" }),
        minute,
        NotificationState::Unseen,
    )
}

/// The same notification in another state.
pub(crate) fn with_state(
    notification: &FeedNotification,
    state: NotificationState,
) -> FeedNotification {
    let mut row = (**notification).clone();
    row.state = state;
    Arc::new(row)
}

pub(crate) fn ids(notifications: &[FeedNotification]) -> Vec<Uuid> {
    notifications.iter().map(|n| n.notification_id).collect()
}
