use crate::metadata::{ChannelMentionMetadata, ChannelMessageSendMetadata, ChannelReplyMetadata};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
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

/// The alert iOS shows and Android copies: a channel names itself, a direct
/// message only the sender.
#[test]
fn channel_alerts_name_the_channel_and_direct_messages_only_the_sender() {
    let ada = MacroUserIdStr::parse_from_str("macro|ada@example.com").unwrap();
    let entity = EntityType::Channel.with_entity_str("019a0000-0000-7000-8000-000000000001");
    let message = |channel_type: &str| -> ChannelMessageSendMetadata {
        serde_json::from_value(json!({
            "sender": "macro|ada@example.com",
            "messageId": "019a0000-0000-7000-8000-000000000002",
            "messageContent": "Ship it",
            "channelType": channel_type,
            "channelName": "design"
        }))
        .unwrap()
    };
    let mention = |channel_type: &str| -> ChannelMentionMetadata {
        serde_json::from_value(json!({
            "messageId": "019a0000-0000-7000-8000-000000000002",
            "messageContent": "Ship it",
            "channelType": channel_type,
            "channelName": "design"
        }))
        .unwrap()
    };
    let reply: ChannelReplyMetadata = serde_json::from_value(json!({
        "userId": "macro|ada@example.com",
        "threadId": "019a0000-0000-7000-8000-000000000003",
        "messageId": "019a0000-0000-7000-8000-000000000002",
        "messageContent": "Ship it",
        "channelType": "public",
        "channelName": "design"
    }))
    .unwrap();

    for (apns, title) in [
        (
            message("public").as_apns(Some(ada.copied()), &entity, Uuid::nil()),
            "ada <design>",
        ),
        (
            message("directMessage").as_apns(Some(ada.copied()), &entity, Uuid::nil()),
            "ada",
        ),
        (
            mention("private").as_apns(Some(ada.copied()), &entity, Uuid::nil()),
            "ada mentioned you in #design",
        ),
        (
            mention("directMessage").as_apns(Some(ada.copied()), &entity, Uuid::nil()),
            "ada mentioned you",
        ),
        (
            reply.as_apns(Some(ada.copied()), &entity, Uuid::nil()),
            "Reply from ada",
        ),
    ] {
        let alert = &serde_json::to_value(apns.unwrap()).unwrap()["aps"]["alert"];
        assert_eq!(alert["title"], title);
        assert_eq!(alert["body"], "Ship it");
    }
}
