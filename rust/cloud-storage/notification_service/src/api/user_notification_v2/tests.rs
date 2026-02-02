use super::*;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use notification::domain::models::UserNotificationRow;

/// Build a [`UserNotificationRow<serde_json::Value>`] with the given event type
/// and raw JSON metadata, suitable for passing through [`to_typed_row`].
fn make_row(
    event_type: &str,
    metadata: serde_json::Value,
) -> UserNotificationRow<serde_json::Value> {
    UserNotificationRow {
        owner_id: MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap(),
        notification_id: uuid::Uuid::nil(),
        notification_event_type: event_type.to_string(),
        entity: EntityType::Document.with_entity_string("entity-1".to_string()),
        sent: true,
        done: false,
        created_at: None,
        viewed_at: None,
        updated_at: None,
        deleted_at: None,
        notification_metadata: metadata,
        sender_id: Some(
            MacroUserIdStr::parse_from_str("macro|sender@example.com")
                .unwrap()
                .into_owned(),
        ),
    }
}

#[test]
fn to_typed_row_channel_mention() {
    let metadata = serde_json::json!({
        "messageId": "msg-1",
        "messageContent": "hello @user",
        "channelType": "Public",
        "channelName": "general"
    });
    let row = make_row("channel_mention", metadata);
    let typed = to_typed_row(row).expect("should deserialize channel_mention");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::ChannelMention(_)
    ));
}

#[test]
fn to_typed_row_document_mention() {
    let metadata = serde_json::json!({
        "documentName": "doc.pdf",
        "owner": "macro|owner@example.com"
    });
    let row = make_row("document_mention", metadata);
    let typed = to_typed_row(row).expect("should deserialize document_mention");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::DocumentMention(_)
    ));
}

#[test]
fn to_typed_row_channel_invite() {
    let metadata = serde_json::json!({
        "invitedBy": "macro|admin@example.com",
        "channelType": "Private",
        "channelName": "secret"
    });
    let row = make_row("channel_invite", metadata);
    let typed = to_typed_row(row).expect("should deserialize channel_invite");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::ChannelInvite(_)
    ));
}

#[test]
fn to_typed_row_channel_message_send() {
    let metadata = serde_json::json!({
        "sender": "macro|sender@example.com",
        "messageContent": "hi",
        "messageId": "msg-2",
        "channelType": "DirectMessage",
        "channelName": "dm"
    });
    let row = make_row("channel_message_send", metadata);
    let typed = to_typed_row(row).expect("should deserialize channel_message_send");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::ChannelMessageSend(_)
    ));
}

#[test]
fn to_typed_row_channel_message_reply() {
    let metadata = serde_json::json!({
        "threadId": "thread-1",
        "messageId": "msg-3",
        "userId": "macro|replier@example.com",
        "messageContent": "reply",
        "channelType": "Public",
        "channelName": "general"
    });
    let row = make_row("channel_message_reply", metadata);
    let typed = to_typed_row(row).expect("should deserialize channel_message_reply");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::ChannelMessageReply(_)
    ));
}

#[test]
fn to_typed_row_new_email() {
    let metadata = serde_json::json!({
        "sender": "ext@example.com",
        "toEmail": "user@example.com",
        "threadId": "thread-2",
        "subject": "Hello",
        "snippet": "Hi there"
    });
    let row = make_row("new_email", metadata);
    let typed = to_typed_row(row).expect("should deserialize new_email");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::NewEmail(_)
    ));
}

#[test]
fn to_typed_row_invite_to_team() {
    let metadata = serde_json::json!({
        "teamName": "Engineering",
        "teamId": "team-1",
        "invitedBy": "macro|admin@example.com",
        "role": null
    });
    let row = make_row("invite_to_team", metadata);
    let typed = to_typed_row(row).expect("should deserialize invite_to_team");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::InviteToTeam(_)
    ));
}

#[test]
fn to_typed_row_task_assigned() {
    let metadata = serde_json::json!({
        "taskId": "task-1",
        "taskName": "Fix bug",
        "assignedBy": "macro|manager@example.com"
    });
    let row = make_row("task_assigned", metadata);
    let typed = to_typed_row(row).expect("should deserialize task_assigned");
    assert!(matches!(
        typed.notification_metadata,
        NotifEvent::TaskAssigned(_)
    ));
}

#[test]
fn to_typed_row_unknown_event_type_fails() {
    let metadata = serde_json::json!({"foo": "bar"});
    let row = make_row("unknown_event", metadata);
    assert!(to_typed_row(row).is_err());
}

#[test]
fn to_typed_row_preserves_row_fields() {
    let metadata = serde_json::json!({
        "taskId": "task-1",
        "taskName": "My Task",
        "assignedBy": "macro|assigner@example.com"
    });
    let row = make_row("task_assigned", metadata);
    let typed = to_typed_row(row).expect("should deserialize");

    assert_eq!(
        typed.owner_id,
        MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap()
    );
    assert_eq!(typed.notification_id, uuid::Uuid::nil());
    assert_eq!(typed.notification_event_type, "task_assigned");
    assert!(typed.sent);
    assert!(!typed.done);

    match typed.notification_metadata {
        NotifEvent::TaskAssigned(ref meta) => {
            assert_eq!(meta.task_id, "task-1");
            assert_eq!(meta.task_name.as_deref(), Some("My Task"));
        }
        _ => panic!("expected TaskAssigned variant"),
    }
}
