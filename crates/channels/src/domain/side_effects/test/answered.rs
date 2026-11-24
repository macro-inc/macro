//! A bot's pending reply, once resolved into its answer, tells the person it
//! was posted for directly, as a mention, instead of as a thread reply.

use super::*;

const CHANNEL: Uuid = Uuid::from_u128(1);
const THREAD: Uuid = Uuid::from_u128(2);
const REPLY: Uuid = Uuid::from_u128(3);

fn member(user_id: &MacroUserIdStr<'static>) -> ChannelParticipant {
    ChannelParticipant {
        channel_id: CHANNEL,
        user_id: user_id.as_ref().to_string(),
        role: ParticipantRole::Member,
        joined_at: Utc::now(),
        left_at: None,
    }
}

fn asker() -> MacroUserIdStr<'static> {
    user("asker@example.com")
}

fn follower() -> MacroUserIdStr<'static> {
    user("follower@example.com")
}

/// The bot's reply in the asker's thread, patched into `content`.
fn answer(triggered_by: Option<String>, content: &str, finalized_reply: bool) -> ChannelEvent {
    let now = Utc::now();
    ChannelEvent::MessagePosted {
        channel_id: CHANNEL,
        metadata: ChannelMetadata {
            channel_type: ChannelType::Public,
            channel_name: "feature-requests".to_string(),
            named: true,
        },
        participants: vec![member(&asker()), member(&follower())],
        message: MutatedMessage {
            id: REPLY,
            channel_id: CHANNEL,
            thread_id: Some(THREAD),
            sender_id: Sender::new_from_bot(BotId::new_from_uuid(Uuid::from_u128(9))),
            triggered_by,
            triggered_via: None,
            content: content.to_string(),
            created_at: now,
            updated_at: now,
            edited_at: Some(now),
            deleted_at: None,
        },
        mentions: Vec::new(),
        has_attachments: false,
        notification_policy: PostMessageNotificationPolicy::Default,
        finalized_reply,
    }
}

fn service(notifications: &FakeNotifications) -> impl ChannelEventHandler {
    ChannelSideEffectService::new(
        FakeContext {
            thread_context: ThreadNotificationContext {
                participants: vec![asker(), follower()],
                connected_call_participants: vec![],
                parent_sender_id: Some(asker()),
            },
            ..FakeContext::default()
        },
        FakeRealtime::default(),
        notifications.clone(),
        FakeContacts::default(),
    )
}

fn answered_mentions(notifications: &FakeNotifications) -> Vec<(MacroUserIdStr<'static>, Uuid)> {
    notifications
        .effects
        .lock()
        .unwrap()
        .iter()
        .filter_map(|effect| match effect {
            ChannelNotificationEffect::AnsweredMention {
                recipient_id,
                notification_id,
                ..
            } => Some((recipient_id.clone(), *notification_id)),
            _ => None,
        })
        .collect()
}

fn reply(
    notifications: &FakeNotifications,
) -> (
    HashSet<MacroUserIdStr<'static>>,
    HashSet<MacroUserIdStr<'static>>,
) {
    notifications
        .effects
        .lock()
        .unwrap()
        .iter()
        .find_map(|effect| match effect {
            ChannelNotificationEffect::Reply {
                recipient_ids,
                mention_fallback_ids,
                ..
            } => Some((recipient_ids.clone(), mention_fallback_ids.clone())),
            _ => None,
        })
        .expect("expected a reply notification")
}

/// The asker hears once, as a mention a mentions-only channel or one with
/// replies off lets through; the rest of the thread hears the reply.
#[tokio::test]
async fn a_resolved_answer_tells_the_asker_as_a_mention() {
    let notifications = FakeNotifications::default();

    service(&notifications)
        .handle(answer(
            Some(asker().as_ref().to_string()),
            "Here is the answer",
            true,
        ))
        .await;

    let mentions = answered_mentions(&notifications);
    assert_eq!(mentions.len(), 1, "{mentions:?}");
    assert_eq!(mentions[0].0, asker());
    let (recipients, fallbacks) = reply(&notifications);
    assert_eq!(recipients, HashSet::from([follower()]));
    // An asker who turned mentions off for the channel hears the reply.
    assert_eq!(fallbacks, HashSet::from([asker()]));
}

/// Redelivering the same resolution keeps the id, so ingress creates the
/// notification once; a different answer later (after a question) is news.
#[tokio::test]
async fn the_same_answer_keeps_its_id_and_a_new_one_gets_another() {
    let notifications = FakeNotifications::default();
    let service = service(&notifications);
    let asked_by = Some(asker().as_ref().to_string());

    service
        .handle(answer(asked_by.clone(), "Which inbox?", true))
        .await;
    service
        .handle(answer(asked_by.clone(), "Which inbox?", true))
        .await;
    service
        .handle(answer(asked_by, "Here is the answer", true))
        .await;

    let ids: Vec<_> = answered_mentions(&notifications)
        .into_iter()
        .map(|(_, id)| id)
        .collect();
    assert_eq!(ids.len(), 3);
    assert_eq!(ids[0], ids[1]);
    assert_ne!(ids[1], ids[2]);
}

/// A post that is not a resolved reply notifies as it always did.
#[tokio::test]
async fn a_bot_post_that_is_not_a_resolved_reply_tells_nobody_directly() {
    let notifications = FakeNotifications::default();

    service(&notifications)
        .handle(answer(
            Some(asker().as_ref().to_string()),
            "Posted for you",
            false,
        ))
        .await;

    assert!(answered_mentions(&notifications).is_empty());
    let (recipients, _) = reply(&notifications);
    assert_eq!(recipients, HashSet::from([asker(), follower()]));
}

/// Nobody is told directly when the reply names no person it answers: no
/// trigger, a bot, or a principal that is not a user id.
#[tokio::test]
async fn an_answer_for_nobody_a_bot_or_a_system_principal_tells_nobody_directly() {
    let bot = BotId::new_from_uuid(Uuid::from_u128(7))
        .into_storage_id()
        .to_string();
    for triggered_by in [None, Some(bot), Some("system".to_string())] {
        let notifications = FakeNotifications::default();

        service(&notifications)
            .handle(answer(triggered_by.clone(), "Here is the answer", true))
            .await;

        assert!(
            answered_mentions(&notifications).is_empty(),
            "{triggered_by:?}"
        );
        let (recipients, _) = reply(&notifications);
        assert_eq!(
            recipients,
            HashSet::from([asker(), follower()]),
            "{triggered_by:?}"
        );
    }
}

/// Someone who left the channel is not told directly.
#[tokio::test]
async fn an_answer_for_someone_who_left_tells_nobody_directly() {
    let notifications = FakeNotifications::default();
    let outsider = user("outsider@example.com");

    service(&notifications)
        .handle(answer(
            Some(outsider.as_ref().to_string()),
            "Here is the answer",
            true,
        ))
        .await;

    assert!(answered_mentions(&notifications).is_empty());
}

/// A reply that @mentions the asker already tells them; they get that
/// mention only.
#[tokio::test]
async fn an_answer_that_mentions_the_asker_sends_only_that_mention() {
    let notifications = FakeNotifications::default();
    let ChannelEvent::MessagePosted {
        channel_id,
        metadata,
        participants,
        message,
        has_attachments,
        notification_policy,
        finalized_reply,
        ..
    } = answer(Some(asker().as_ref().to_string()), "Done", true)
    else {
        unreachable!();
    };

    service(&notifications)
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata,
            participants,
            message,
            mentions: vec![SimpleMention::user(&asker())],
            has_attachments,
            notification_policy,
            finalized_reply,
        })
        .await;

    assert!(answered_mentions(&notifications).is_empty());
    let mentioned: Vec<_> = notifications
        .effects
        .lock()
        .unwrap()
        .iter()
        .filter_map(|effect| match effect {
            ChannelNotificationEffect::UserMention { recipient_ids, .. } => {
                Some(recipient_ids.clone())
            }
            _ => None,
        })
        .collect();
    assert_eq!(mentioned, vec![HashSet::from([asker()])]);
}

/// An answer outside a thread, as in a conversation on the channel's
/// timeline: the asker is left out of the channel message and kept as its
/// mention fallback.
#[tokio::test]
async fn a_top_level_answer_tells_the_asker_as_a_mention() {
    let notifications = FakeNotifications::default();
    let ChannelEvent::MessagePosted {
        channel_id,
        metadata,
        participants,
        mut message,
        mentions,
        has_attachments,
        notification_policy,
        finalized_reply,
    } = answer(Some(asker().as_ref().to_string()), "Done", true)
    else {
        unreachable!();
    };
    message.thread_id = None;

    service(&notifications)
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata,
            participants,
            message,
            mentions,
            has_attachments,
            notification_policy,
            finalized_reply,
        })
        .await;

    assert_eq!(answered_mentions(&notifications).len(), 1);
    let message = notifications
        .effects
        .lock()
        .unwrap()
        .iter()
        .find_map(|effect| match effect {
            ChannelNotificationEffect::ChannelMessage {
                recipient_ids,
                mention_fallback_ids,
                ..
            } => Some((recipient_ids.clone(), mention_fallback_ids.clone())),
            _ => None,
        })
        .expect("expected a channel message notification");
    assert_eq!(message.0, HashSet::from([follower()]));
    assert_eq!(message.1, HashSet::from([asker()]));
}

/// Only a bot's reply answers anyone: a person's own edit never does.
#[tokio::test]
async fn a_persons_edit_tells_nobody_directly() {
    let notifications = FakeNotifications::default();
    let ChannelEvent::MessagePosted {
        channel_id,
        metadata,
        participants,
        mut message,
        mentions,
        has_attachments,
        notification_policy,
        finalized_reply,
    } = answer(Some(asker().as_ref().to_string()), "Done", true)
    else {
        unreachable!();
    };
    message.sender_id = Sender::new_from_user(follower());

    service(&notifications)
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata,
            participants,
            message,
            mentions,
            has_attachments,
            notification_policy,
            finalized_reply,
        })
        .await;

    assert!(answered_mentions(&notifications).is_empty());
}
