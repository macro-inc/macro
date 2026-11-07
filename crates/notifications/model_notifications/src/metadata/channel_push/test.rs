use crate::metadata::{ChannelMentionMetadata, ChannelMessageSendMetadata, ChannelReplyMetadata};
use model_entity::EntityType;
use notification::domain::models::{NotificationExtIos, apple::PushNotificationData};
use serde_json::json;
use uuid::Uuid;

#[test]
fn top_level_message_push_contains_the_destination_before_notification_fetch() {
    let metadata: ChannelMessageSendMetadata = serde_json::from_value(json!({
        "senderDisplayName": "Macro Bot",
        "messageId": "019a0000-0000-7000-8000-000000000002",
        "messageContent": "Hello",
        "channelType": "directMessage",
        "channelName": "General"
    }))
    .unwrap();
    let apns = metadata
        .as_apns(
            None,
            &EntityType::Channel.with_entity_str("019a0000-0000-7000-8000-000000000001"),
            Uuid::nil(),
        )
        .unwrap();
    let payload = serde_json::to_value(apns).unwrap();
    assert_eq!(payload["notificationId"], Uuid::nil().to_string());
    assert_eq!(payload["aps"]["alert"]["body"], "Hello");
    assert_eq!(
        payload["navigation"],
        json!({
            "type": "channel",
            "channelId": "019a0000-0000-7000-8000-000000000001",
            "messageId": "019a0000-0000-7000-8000-000000000002",
            "threadId": null
        })
    );
    // Recipients are attached at delivery, never copied from the sender.
    assert!(payload.get("recipientId").is_none());
}

#[test]
fn reply_push_includes_the_thread_root() {
    let metadata: ChannelReplyMetadata = serde_json::from_value(json!({
        "senderDisplayName": "Macro Bot",
        "threadId": "019a0000-0000-7000-8000-000000000002",
        "messageId": "019a0000-0000-7000-8000-000000000003",
        "messageContent": "Reply",
        "channelType": "public",
        "channelName": "General"
    }))
    .unwrap();
    let apns = metadata
        .as_apns(
            None,
            &EntityType::Channel.with_entity_str("019a0000-0000-7000-8000-000000000001"),
            Uuid::nil(),
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(apns).unwrap()["navigation"],
        json!({
            "type": "channel",
            "channelId": "019a0000-0000-7000-8000-000000000001",
            "messageId": "019a0000-0000-7000-8000-000000000003",
            "threadId": "019a0000-0000-7000-8000-000000000002"
        })
    );
}

#[test]
fn channel_mentions_distinguish_top_level_messages_from_replies() {
    for thread_id in [None, Some("019a0000-0000-7000-8000-000000000002")] {
        let metadata: ChannelMentionMetadata = serde_json::from_value(json!({
            "senderDisplayName": "Macro Bot",
            "threadId": thread_id,
            "messageId": "019a0000-0000-7000-8000-000000000003",
            "messageContent": "Mention",
            "channelType": "private",
            "channelName": "General"
        }))
        .unwrap();
        let apns = metadata
            .as_apns(
                None,
                &EntityType::Channel.with_entity_str("019a0000-0000-7000-8000-000000000001"),
                Uuid::nil(),
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(apns).unwrap()["navigation"],
            json!({
                "type": "channel",
                "channelId": "019a0000-0000-7000-8000-000000000001",
                "messageId": "019a0000-0000-7000-8000-000000000003",
                "threadId": thread_id
            })
        );
    }
}

#[test]
fn malformed_legacy_ids_keep_alerts_without_a_broken_destination() {
    let metadata: ChannelMessageSendMetadata = serde_json::from_value(json!({
        "senderDisplayName": "Macro Bot",
        "messageId": "legacy-message",
        "messageContent": "Hello",
        "channelType": "public",
        "channelName": "General"
    }))
    .unwrap();
    let apns = metadata
        .as_apns(
            None,
            &EntityType::Channel.with_entity_str("019a0000-0000-7000-8000-000000000001"),
            Uuid::nil(),
        )
        .unwrap();
    let payload = serde_json::to_value(apns).unwrap();
    assert!(payload.get("navigation").is_none());
    assert_eq!(payload["aps"]["alert"]["body"], "Hello");
}

#[test]
fn queued_legacy_push_data_does_not_require_navigation_or_recipient() {
    let payload: PushNotificationData = serde_json::from_value(json!({
        "notificationId": "019a0000-0000-7000-8000-000000000004"
    }))
    .unwrap();
    assert!(payload.navigation.is_none());
    assert!(payload.recipient_id.is_none());
}
