use super::*;
use chrono::Utc;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::ChannelMentionMetadata;
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
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
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
        "channelName": "general",
        "channelType": "Public",
        "documentName": "doc.pdf",
        "messageContent": "see doc.pdf",
        "messageId": "msg-1",
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
        "teamId": "00000000-0000-0000-0000-000000000001",
        "teamInviteId": "00000000-0000-0000-0000-000000000002",
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

/// Simulates listing notifications when some DB rows have malformed metadata.
/// Valid rows must still be returned; malformed rows are silently dropped.
/// This mirrors the `partition_map` logic in `list_typed_notifications`.
#[test]
fn to_typed_row_returns_valid_notifications_despite_malformed_rows() {
    let valid_mention = make_row(
        "channel_mention",
        serde_json::json!({
            "messageId": "msg-1",
            "messageContent": "hello @user",
            "channelType": "Public",
            "channelName": "general"
        }),
    );
    let malformed_metadata = make_row("channel_mention", serde_json::json!({"garbage": true}));
    let unknown_event = make_row("totally_bogus_event", serde_json::json!({"a": 1}));
    let valid_email = make_row(
        "new_email",
        serde_json::json!({
            "sender": "ext@example.com",
            "toEmail": "user@example.com",
            "threadId": "thread-2",
            "subject": "Hello",
            "snippet": "Hi there"
        }),
    );
    let empty_metadata = make_row("channel_message_send", serde_json::json!({}));

    let rows = vec![
        valid_mention,
        malformed_metadata,
        unknown_event,
        valid_email,
        empty_metadata,
    ];

    let (ok, err): (Vec<_>, Vec<_>) = rows
        .into_iter()
        .map(|r| to_typed_row(r))
        .partition(Result::is_ok);

    assert_eq!(ok.len(), 2, "expected exactly the 2 valid rows to succeed");
    assert_eq!(
        err.len(),
        3,
        "expected exactly the 3 malformed rows to fail"
    );

    assert!(matches!(
        ok[0].as_ref().unwrap().notification_metadata,
        NotifEvent::ChannelMention(_)
    ));
    assert!(matches!(
        ok[1].as_ref().unwrap().notification_metadata,
        NotifEvent::NewEmail(_)
    ));
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

/// Verifies that the `notification_metadata` field serializes identically between
/// `ApiUserNotification` and `ConnGatewayInnerNotif`.
/// This ensures frontend code can use the same parsing logic for both HTTP API and WebSocket delivery.
#[test]
fn api_user_notification_and_conn_gateway_inner_notif_metadata_serialize_identically() {
    use chrono::{TimeZone, Utc};
    use notification::domain::models::TaggedContent;
    use notification::domain::models::queue_message::ConnGatewayInnerNotif;

    let created_at = Utc.with_ymd_and_hms(2025, 1, 15, 12, 0, 0).unwrap();
    let notification_id = uuid::Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let entity = EntityType::Document.with_entity_string("doc-123".to_string());

    let notif_metadata = ChannelMentionMetadata {
        message_id: "msg-1".to_string(),
        message_content: "Hello @user".to_string(),
        has_attachments: false,
        thread_id: None,
        common: model_notifications::CommonChannelMetadata {
            channel_type: model_notifications::ChannelType::Public,
            channel_name: "general".to_string(),
        },
        sender_profile_picture_url: None,
    };

    // Create ApiUserNotification (used by HTTP API)
    let api_notif = ApiUserNotification {
        owner_id: MacroUserIdStr::parse_from_str("macro|user@example.com")
            .unwrap()
            .into_owned(),
        notification_id,
        notification_event_type: "channel_mention".to_string(),
        entity: entity.clone(),
        sent: true,
        done: false,
        created_at,
        viewed_at: None,
        updated_at: created_at,
        deleted_at: None,
        notification_metadata: NotifEvent::ChannelMention(notif_metadata.clone()),
        sender_id: Some(
            MacroUserIdStr::parse_from_str("macro|sender@example.com")
                .unwrap()
                .into_owned(),
        ),
    };

    // Create ConnGatewayInnerNotif (used by WebSocket delivery)
    let conn_gateway_notif = ConnGatewayInnerNotif {
        notification_id,
        notification_event_type: "channel_mention".to_string(),
        entity,
        sent: true,
        done: false,
        created_at,
        viewed_at: None,
        updated_at: created_at,
        deleted_at: None,
        notification_metadata: TaggedContent::new(notif_metadata),
        sender_id: Some(
            MacroUserIdStr::parse_from_str("macro|sender@example.com")
                .unwrap()
                .into_owned(),
        ),
    };

    let api_json = serde_json::to_value(&api_notif).unwrap();
    let conn_gateway_json = serde_json::to_value(&conn_gateway_notif).unwrap();

    let key = "notification_metadata";
    let api_metadata = &api_json[key];
    let conn_gateway_metadata = &conn_gateway_json[key];

    assert_eq!(
        api_metadata,
        conn_gateway_metadata,
        "notification_metadata should serialize identically.\n\
         ApiUserNotification (HTTP API): {}\n\
         ConnGatewayInnerNotif (WebSocket): {}",
        serde_json::to_string_pretty(api_metadata).unwrap(),
        serde_json::to_string_pretty(conn_gateway_metadata).unwrap(),
    );
}

/// Verifies that `TaggedContent<T>` (used by ConnGatewayInnerNotif for WebSocket delivery)
/// and `NotifEvent` (used by ApiUserNotification for HTTP API) serialize identically.
/// This ensures frontend code can use the same parsing logic for both delivery methods.
#[test]
fn conn_gateway_inner_val_has_identical_serialization() {
    use notification::domain::models::TaggedContent;

    // Create test notification metadata
    let notif_metadata = ChannelMentionMetadata {
        message_id: "testing".to_string(),
        message_content: "some data".to_string(),
        has_attachments: false,
        thread_id: Some("threadid".to_string()),
        common: model_notifications::CommonChannelMetadata {
            channel_type: model_notifications::ChannelType::Public,
            channel_name: "my channel".to_string(),
        },
        sender_profile_picture_url: None,
    };

    // TaggedContent<T> is what ConnGatewayInnerNotif uses for notification_metadata
    // when sending via WebSocket
    let tagged_content = TaggedContent::new(notif_metadata.clone());
    let tagged_content_json = serde_json::to_value(&tagged_content).unwrap();

    // NotifEvent is what ApiUserNotification uses for notification_metadata
    // when returning via HTTP API
    let notif_event = NotifEvent::ChannelMention(notif_metadata);
    let notif_event_json = serde_json::to_value(&notif_event).unwrap();

    // Both should serialize to the same JSON structure:
    // { "tag": "channel_mention", "content": { "messageId": "...", ... } }
    assert_eq!(
        tagged_content_json,
        notif_event_json,
        "TaggedContent and NotifEvent should serialize identically.\n\
         TaggedContent (WebSocket): {}\n\
         NotifEvent (HTTP API): {}",
        serde_json::to_string_pretty(&tagged_content_json).unwrap(),
        serde_json::to_string_pretty(&notif_event_json).unwrap(),
    );

    // Verify the expected structure
    assert_eq!(tagged_content_json["tag"], "channel_mention");
    assert_eq!(notif_event_json["tag"], "channel_mention");

    // Verify content fields are serialized in camelCase as expected
    assert_eq!(tagged_content_json["content"]["messageId"], "testing");
    assert_eq!(
        tagged_content_json["content"]["messageContent"],
        "some data"
    );
    assert_eq!(tagged_content_json["content"]["threadId"], "threadid");
    assert_eq!(tagged_content_json["content"]["channelType"], "public");
    assert_eq!(tagged_content_json["content"]["channelName"], "my channel");
}
