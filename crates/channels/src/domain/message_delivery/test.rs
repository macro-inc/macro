use super::*;
use crate::domain::{
    models::{ChannelInfo, ChannelParticipant, ChannelType, ParticipantRole},
    ports::MockChannelRepo,
};
use chrono::Utc;
use messages::domain::models::SimpleMention;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
struct Log {
    events: Arc<Mutex<Vec<ChannelEvent>>>,
    live: Arc<Mutex<Vec<(String, HashSet<String>)>>>,
    shares: Arc<Mutex<usize>>,
    fail_live: bool,
}

impl ChannelEventDispatcher for Log {
    fn dispatch(&self, event: ChannelEvent) {
        self.events.lock().unwrap().push(event);
    }
}

impl MessageRealtime for Log {
    async fn subscribers(&self, _: &MessageParent) -> Result<HashSet<String>, rootcause::Report> {
        Ok(HashSet::new())
    }
    async fn send(
        &self,
        event: &MessageEvent,
        users: HashSet<String>,
    ) -> Result<(), rootcause::Report> {
        let kind = serde_json::to_value(event).unwrap()["change"]["type"]
            .as_str()
            .unwrap()
            .to_owned();
        self.live.lock().unwrap().push((kind, users));
        if self.fail_live {
            return Err(rootcause::report!("realtime unavailable"));
        }
        Ok(())
    }
}

impl ChannelReferenceSharePermissions for Log {
    type Err = anyhow::Error;
    async fn update_channel_share_permissions_for_referenced_items(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
        _: Vec<ReferencedShareItem>,
    ) -> Result<(), Self::Err> {
        *self.shares.lock().unwrap() += 1;
        anyhow::bail!("sharing temporarily unavailable")
    }
}

const CHANNEL: Uuid = Uuid::from_u128(2);
const MEMBER: &str = "macro|member@example.com";
const SENDER: &str = "macro|sender@example.com";

fn repo() -> MockChannelRepo {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_participants().returning(|channel_id| {
        Box::pin(async move {
            Ok([SENDER, MEMBER]
                .into_iter()
                .map(|user_id| ChannelParticipant {
                    channel_id,
                    user_id: user_id.to_owned(),
                    role: ParticipantRole::Member,
                    joined_at: Utc::now(),
                    left_at: None,
                })
                .collect())
        })
    });
    repo.expect_upsert_activity()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    repo.expect_touch_channel_updated_at()
        .returning(|_| Box::pin(async { Ok(()) }));
    repo.expect_get_channel_metadata().returning(|_, _| {
        Box::pin(async {
            Ok(ChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "Test".into(),
            })
        })
    });
    repo.expect_get_channel_info().returning(|id| {
        Box::pin(async move {
            Ok(ChannelInfo {
                id,
                name: Some("Test".into()),
                channel_type: ChannelType::Private,
                org_id: None,
                team_id: None,
            })
        })
    });
    repo
}

fn message() -> Message {
    Message {
        id: Uuid::from_u128(1),
        parent: MessageParent::Channel(CHANNEL),
        thread_id: None,
        sender_id: SENDER.to_owned().try_into().unwrap(),
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        content: "Message".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        reactions: vec![],
        attachments: vec![MessageAttachment {
            id: Uuid::from_u128(4),
            entity_type: "document".into(),
            entity_id: Uuid::from_u128(3).to_string(),
            width: None,
            height: None,
            created_at: Utc::now(),
        }],
    }
}

fn event(change: MessageChange) -> MessageEvent {
    MessageEvent {
        parent: MessageParent::Channel(CHANNEL),
        actor: SENDER.to_owned(),
        nonce: Some("n1".into()),
        change,
    }
}

fn mentions() -> Vec<SimpleMention> {
    vec![SimpleMention {
        entity_type: "document".into(),
        entity_id: Uuid::from_u128(3).to_string(),
    }]
}

fn live_users() -> HashSet<String> {
    [SENDER, MEMBER].map(str::to_owned).into()
}

#[tokio::test]
async fn a_post_emits_the_legacy_channel_event_and_the_common_payload() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    assert!(
        delivery
            .publish(event(MessageChange::Posted {
                notification_policy: Default::default(),
                message: message(),
                mentions: mentions(),
            }))
            .await
            .is_err(),
        "the sharing failure is reported after every other effect ran"
    );
    assert_eq!(*log.shares.lock().unwrap(), 1);
    let events = log.events.lock().unwrap();
    let [
        ChannelEvent::MessagePosted {
            channel_id,
            message,
            attachments,
            has_attachments,
            nonce,
            participants,
            ..
        },
    ] = events.as_slice()
    else {
        panic!("expected one posted event, got {events:?}");
    };
    assert_eq!(*channel_id, CHANNEL);
    assert_eq!(message.id, Uuid::from_u128(1));
    assert_eq!(message.channel_id, CHANNEL);
    assert!(has_attachments);
    assert_eq!(attachments[0].channel_id, CHANNEL);
    assert_eq!(nonce.as_deref(), Some("n1"));
    assert_eq!(participants.len(), 2);
    assert_eq!(
        *log.live.lock().unwrap(),
        vec![("posted".to_owned(), live_users())]
    );
}

#[tokio::test]
async fn edits_emit_attachment_changes_before_the_message_change() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    let previous = MessageAttachment {
        id: Uuid::from_u128(5),
        entity_type: "document".into(),
        entity_id: Uuid::from_u128(6).to_string(),
        width: None,
        height: None,
        created_at: Utc::now(),
    };
    assert!(
        delivery
            .publish(event(MessageChange::Edited {
                notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                message: message(),
                mentions: vec![],
                previous_attachments: vec![previous],
            }))
            .await
            .is_err(),
        "the attachment's sharing failure is reported after the events were dispatched"
    );
    let events = log.events.lock().unwrap();
    let [
        ChannelEvent::AttachmentsChanged { added, removed, .. },
        ChannelEvent::MessageChanged {
            posted_notification,
            ..
        },
    ] = events.as_slice()
    else {
        panic!("expected attachment and message events, got {events:?}");
    };
    assert_eq!(added[0].id, Uuid::from_u128(4));
    assert_eq!(removed[0].id, Uuid::from_u128(5));
    assert!(posted_notification.is_some());
    assert_eq!(log.live.lock().unwrap()[0].0, "edited");
}

#[tokio::test]
async fn deletions_reactions_and_typing_map_to_their_legacy_events() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    for change in [
        MessageChange::MessageDeleted { message: message() },
        MessageChange::ReactionChanged { message: message() },
        MessageChange::Typing {
            thread_id: Some(Uuid::from_u128(9)),
            active: false,
        },
    ] {
        delivery.publish(event(change)).await.unwrap();
    }
    let events = log.events.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [
            ChannelEvent::MessageDeleted { .. },
            ChannelEvent::ReactionChanged { .. },
            ChannelEvent::TypingChanged {
                action: TypingAction::Stop,
                thread_id: Some(thread),
                ..
            },
        ] if *thread == Uuid::from_u128(9)
    ));
    assert_eq!(
        log.live
            .lock()
            .unwrap()
            .iter()
            .map(|(kind, _)| kind.as_str())
            .collect::<Vec<_>>(),
        ["message_deleted", "reaction_changed", "typing"]
    );
}

#[tokio::test]
async fn thread_updates_stay_off_the_channel_side_effect_path() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    delivery
        .publish(event(MessageChange::ThreadUpdated {
            state: messages::domain::models::ThreadState {
                root_id: Uuid::from_u128(1),
                user_id: SENDER.into(),
                resolved: true,
                anchor: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                deleted_at: None,
            },
        }))
        .await
        .unwrap();
    assert!(log.events.lock().unwrap().is_empty());
    assert_eq!(log.live.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn realtime_failure_is_reported_after_legacy_effects_were_dispatched() {
    let log = Log {
        fail_live: true,
        ..Default::default()
    };
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    assert!(
        delivery
            .publish(event(MessageChange::MessageDeleted { message: message() }))
            .await
            .is_err()
    );
    assert_eq!(log.events.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn document_events_are_rejected() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    let mut event = event(MessageChange::MessageDeleted { message: message() });
    event.parent = MessageParent::parse("document", "doc").unwrap();
    assert!(delivery.publish(event).await.is_err());
    assert!(log.events.lock().unwrap().is_empty());
}
