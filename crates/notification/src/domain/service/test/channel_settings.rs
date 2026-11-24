use super::*;
use crate::domain::channel_settings::ChannelNotificationKind;
use crate::domain::models::request::SendNotificationRequest;
use crate::domain::section_settings::{
    ChannelSectionMembership, ChannelSectionMembershipReader, SectionMute,
};
use std::collections::BTreeSet;
use strum::IntoEnumIterator;

const CHANNEL_ID: &str = "0194f1a2-0000-7000-8000-000000000001";

/// A top-level channel message, as the channels crate sends it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ChannelMessage {
    message: String,
}

impl Notification for ChannelMessage {
    const TYPE_NAME: &'static str = "channel_message_send";
}

/// The channel's own settings, with every kind on except these.
fn disabled(kinds: &[ChannelNotificationKind]) -> ChannelNotificationSettings {
    ChannelNotificationSettings {
        enabled: Some(
            ChannelNotificationKind::iter()
                .filter(|kind| !kinds.contains(kind))
                .collect(),
        ),
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

/// A channel mention, as the channels crate sends it, including the one a
/// bot's answer sends the person who asked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ChannelMention {
    message: String,
}

impl Notification for ChannelMention {
    const TYPE_NAME: &'static str = "channel_mention";
}

/// A bot's answer reaches the person who asked as a mention: a mentions-only
/// channel or one with thread replies off lets it through, while a muted
/// channel, a global mute or mentions turned off still keep it quiet.
#[tokio::test]
async fn an_answer_reaches_mentions_only_and_replies_off_but_not_a_muted_person() {
    let mentions_only = test_user_id("mentions-only@example.com");
    let replies_off = test_user_id("replies-off@example.com");
    let channel_muted = test_user_id("channel-muted@example.com");
    let muted = test_user_id("muted@example.com");
    let mentions_off = test_user_id("mentions-off@example.com");
    let everything_off = test_user_id("everything-off@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new()
            .with_mentions_only_user(mentions_only.clone())
            .with_channel_settings(
                replies_off.clone(),
                disabled(&[ChannelNotificationKind::ThreadReply]),
            )
            .with_unsubscribed_user(channel_muted.clone())
            .with_muted_user(muted.clone())
            .with_channel_settings(
                mentions_off.clone(),
                disabled(&[ChannelNotificationKind::Mention]),
            )
            .with_channel_settings(
                everything_off.clone(),
                disabled(&ChannelNotificationKind::iter().collect::<Vec<_>>()),
            ),
        MockQueue::new(),
        MockStateMachine,
    );
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_string(CHANNEL_ID.to_string()),
        secondary_notification_entity: None,
        notification: ChannelMention {
            message: "Here is the answer".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([
            mentions_only.clone(),
            replies_off.clone(),
            channel_muted,
            muted,
            mentions_off,
            everything_off,
        ]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap().unwrap();

    assert_eq!(
        result.notified_recipients,
        HashSet::from([mentions_only, replies_off])
    );
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
                    overrides_section_mute: true,
                    ..disabled(&[ChannelNotificationKind::Reaction])
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

/// A document mention, which follows the setting of the message carrying it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct DocumentMention {
    message: String,
}

impl Notification for DocumentMention {
    const TYPE_NAME: &'static str = "document_mention";
}

#[tokio::test]
async fn a_notification_can_name_the_setting_that_decides_it() {
    let replies_off = test_user_id("replies-off@example.com");
    let messages_off = test_user_id("messages-off@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new()
            .with_channel_settings(
                replies_off.clone(),
                disabled(&[ChannelNotificationKind::ThreadReply]),
            )
            .with_channel_settings(
                messages_off.clone(),
                disabled(&[ChannelNotificationKind::TopLevelMessage]),
            ),
        MockQueue::new(),
        MockStateMachine,
    );
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_string(CHANNEL_ID.to_string()),
        secondary_notification_entity: None,
        notification: DocumentMention {
            message: "See the spec".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([replies_off, messages_off.clone()]),
    }
    .into_request()
    .with_channel_settings_kind(ChannelNotificationKind::ThreadReply);

    let result = service.send_notification(request).await.unwrap().unwrap();

    assert_eq!(result.notified_recipients, HashSet::from([messages_off]));
}

/// Sections holding the channel, as the channel sections domain would report.
struct FakeSections(ChannelSectionMembership);

impl ChannelSectionMembershipReader for FakeSections {
    async fn memberships<'a>(
        &self,
        _channel_id: Uuid,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<ChannelSectionMembership, Report> {
        Ok(self.0.clone())
    }
}

const PROJECTS: Uuid = Uuid::from_u128(0x62);

fn section_settings(
    disabled: &[ChannelNotificationKind],
    mute: SectionMute,
) -> SectionNotificationSettings {
    SectionNotificationSettings {
        disabled: disabled.iter().copied().collect(),
        mute,
    }
}

#[tokio::test]
async fn section_settings_apply_to_the_channels_their_sections_hold() {
    let quiet_section = test_user_id("quiet-section@example.com");
    let muted_section = test_user_id("muted-section@example.com");
    let overridden = test_user_id("overridden@example.com");
    let mentions_off = test_user_id("mentions-off@example.com");
    let label = ChannelSection::Label { label_id: PROJECTS };
    let membership = ChannelSectionMembership {
        built_in: Some(ChannelSection::TeamChannels),
        labels: HashMap::from([
            (quiet_section.clone(), vec![PROJECTS]),
            (muted_section.clone(), vec![PROJECTS]),
            (overridden.clone(), vec![PROJECTS]),
        ]),
        favorites: HashSet::new(),
    };
    let service = NotificationIngressService::new(
        MockRepository::new()
            .with_section_settings(
                quiet_section.clone(),
                label,
                section_settings(
                    &[ChannelNotificationKind::TopLevelMessage],
                    SectionMute::Unmuted,
                ),
            )
            .with_section_settings(
                muted_section.clone(),
                label,
                section_settings(&[], SectionMute::Muted),
            )
            .with_section_settings(
                overridden.clone(),
                label,
                section_settings(&[], SectionMute::Muted),
            )
            .with_channel_settings(
                overridden.clone(),
                ChannelNotificationSettings {
                    overrides_section_mute: true,
                    ..Default::default()
                },
            )
            // Team channels holds the channel for this user, whose custom
            // sections don't.
            .with_section_settings(
                mentions_off.clone(),
                ChannelSection::TeamChannels,
                section_settings(&[ChannelNotificationKind::Mention], SectionMute::Unmuted),
            ),
        MockQueue::new(),
        MockStateMachine,
    )
    .with_channel_sections(FakeSections(membership));
    let request = channel_message(&[&quiet_section, &muted_section, &overridden])
        .with_mention_fallback(HashSet::from([mentions_off.clone()]));

    let result = service.send_notification(request).await.unwrap().unwrap();

    assert_eq!(
        result.notified_recipients,
        HashSet::from([overridden, mentions_off])
    );
}

#[tokio::test]
async fn a_channel_with_its_own_settings_ignores_its_sections_kinds() {
    let own_on = test_user_id("own-on@example.com");
    let own_off = test_user_id("own-off@example.com");
    let label = ChannelSection::Label { label_id: PROJECTS };
    let membership = ChannelSectionMembership {
        built_in: None,
        labels: HashMap::from([
            (own_on.clone(), vec![PROJECTS]),
            (own_off.clone(), vec![PROJECTS]),
        ]),
        favorites: HashSet::new(),
    };
    let service = NotificationIngressService::new(
        MockRepository::new()
            // The section turns top-level messages off; this channel's own
            // settings turn them on.
            .with_section_settings(
                own_on.clone(),
                label,
                section_settings(
                    &[ChannelNotificationKind::TopLevelMessage],
                    SectionMute::Unmuted,
                ),
            )
            .with_channel_settings(own_on.clone(), disabled(&[]))
            // The section allows everything; this channel's own settings
            // leave top-level messages out.
            .with_section_settings(
                own_off.clone(),
                label,
                section_settings(&[], SectionMute::Unmuted),
            )
            .with_channel_settings(
                own_off.clone(),
                ChannelNotificationSettings {
                    enabled: Some(BTreeSet::from([ChannelNotificationKind::Mention])),
                    overrides_section_mute: false,
                },
            ),
        MockQueue::new(),
        MockStateMachine,
    )
    .with_channel_sections(FakeSections(membership));

    let result = service
        .send_notification(channel_message(&[&own_on, &own_off]))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(result.notified_recipients, HashSet::from([own_on]));
}
