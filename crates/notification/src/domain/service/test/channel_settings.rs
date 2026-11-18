use super::*;
use crate::domain::channel_settings::ChannelNotificationKind;
use crate::domain::models::request::SendNotificationRequest;
use std::collections::BTreeSet;

const CHANNEL_ID: &str = "0194f1a2-0000-7000-8000-000000000001";

/// A top-level channel message, as the channels crate sends it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ChannelMessage {
    message: String,
}

impl Notification for ChannelMessage {
    const TYPE_NAME: &'static str = "channel_message_send";
}

fn disabled(kinds: &[ChannelNotificationKind]) -> ChannelNotificationSettings {
    ChannelNotificationSettings {
        disabled: kinds.iter().copied().collect(),
        ..Default::default()
    }
}

fn channel_message(
    recipients: &[&MacroUserIdStr<'static>],
) -> SendNotificationRequest<'static, ChannelMessage, ()> {
    SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_string(CHANNEL_ID.to_string()),
        secondary_notification_entity: None,
        notification: ChannelMessage {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: recipients.iter().map(|user| (*user).clone()).collect(),
    }
    .into_request()
}

#[tokio::test]
async fn a_kind_turned_off_for_the_channel_skips_only_that_kind() {
    let quiet = test_user_id("quiet@example.com");
    let no_reactions = test_user_id("no-reactions@example.com");
    let default = test_user_id("default@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new()
            .with_channel_settings(
                quiet.clone(),
                disabled(&[ChannelNotificationKind::TopLevelMessage]),
            )
            .with_channel_settings(
                no_reactions.clone(),
                ChannelNotificationSettings {
                    disabled: BTreeSet::from([ChannelNotificationKind::Reaction]),
                    enabled: BTreeSet::from([ChannelNotificationKind::TopLevelMessage]),
                    overrides_section_mute: true,
                },
            ),
        MockQueue::new(),
        MockStateMachine,
    );

    let result = service
        .send_notification(channel_message(&[&quiet, &no_reactions, &default]))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        result.notified_recipients,
        HashSet::from([no_reactions, default])
    );
}

#[tokio::test]
async fn channel_settings_apply_only_to_channel_notifications() {
    let user = test_user_id("quiet@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new().with_channel_settings(
            user.clone(),
            disabled(&[ChannelNotificationKind::TopLevelMessage]),
        ),
        MockQueue::new(),
        MockStateMachine,
    );
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_string(CHANNEL_ID.to_string()),
        secondary_notification_entity: None,
        notification: ChannelMessage {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user.clone()]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap().unwrap();

    assert_eq!(result.notified_recipients, HashSet::from([user]));
}

#[tokio::test]
async fn mentioned_users_with_mentions_off_get_the_message_instead() {
    let member = test_user_id("member@example.com");
    let mentions_off = test_user_id("mentions-off@example.com");
    let mentions_on = test_user_id("mentions-on@example.com");
    let everything_off = test_user_id("everything-off@example.com");
    let muted = test_user_id("muted@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new()
            .with_channel_settings(
                mentions_off.clone(),
                disabled(&[ChannelNotificationKind::Mention]),
            )
            .with_channel_settings(
                everything_off.clone(),
                disabled(&[
                    ChannelNotificationKind::Mention,
                    ChannelNotificationKind::TopLevelMessage,
                ]),
            )
            .with_channel_settings(muted.clone(), disabled(&[ChannelNotificationKind::Mention]))
            .with_muted_user(muted.clone()),
        MockQueue::new(),
        MockStateMachine,
    );
    let request = channel_message(&[&member]).with_mention_fallback(HashSet::from([
        mentions_off.clone(),
        mentions_on,
        everything_off,
        muted,
    ]));

    let result = service.send_notification(request).await.unwrap().unwrap();

    // The mentions-on user got the mention; the others who turned this
    // message's kind off, or muted everything, stay silent.
    assert_eq!(
        result.notified_recipients,
        HashSet::from([member, mentions_off])
    );
}

#[tokio::test]
async fn a_fallback_alone_still_sends_the_message() {
    let mentions_off = test_user_id("mentions-off@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new().with_channel_settings(
            mentions_off.clone(),
            disabled(&[ChannelNotificationKind::Mention]),
        ),
        MockQueue::new(),
        MockStateMachine,
    );
    let request = channel_message(&[]).with_mention_fallback(HashSet::from([mentions_off.clone()]));

    let result = service.send_notification(request).await.unwrap().unwrap();

    assert_eq!(result.notified_recipients, HashSet::from([mentions_off]));
}
