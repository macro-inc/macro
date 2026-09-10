use super::*;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::Message;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Log {
    events: Arc<Mutex<Vec<ChannelEvent>>>,
    live: Arc<Mutex<usize>>,
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
    async fn send(&self, _: &MessageEvent, _: HashSet<String>) -> Result<(), rootcause::Report> {
        *self.live.lock().unwrap() += 1;
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

fn repo() -> MockChannelRepo {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_participants()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
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
    repo
}
fn message() -> Message {
    Message {
        id: Uuid::from_u128(1),
        parent: MessageParent::Channel(Uuid::from_u128(2)),
        thread_id: None,
        sender_id: "macro|sender@example.com".to_owned().try_into().unwrap(),
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
        attachments: vec![],
    }
}
fn event(change: MessageChange) -> MessageEvent {
    MessageEvent {
        parent: message().parent,
        actor: message().sender_id.as_ref().to_owned(),
        nonce: None,
        change,
    }
}
fn mentions() -> Vec<SimpleMention> {
    vec![SimpleMention {
        entity_type: "document".into(),
        entity_id: Uuid::from_u128(3).to_string(),
    }]
}

#[tokio::test]
async fn sharing_failure_does_not_suppress_committed_post_delivery() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    assert!(
        delivery
            .publish(event(MessageChange::Posted {
                notification_policy: Default::default(),
                message: message(),
                mentions: mentions()
            }))
            .await
            .is_err()
    );
    assert_eq!(*log.live.lock().unwrap(), 1);
    assert_eq!(*log.shares.lock().unwrap(), 1);
    assert!(matches!(
        log.events.lock().unwrap().as_slice(),
        [ChannelEvent::MessageCommitted {
            event,
            ..
        }] if matches!(event.change, MessageChange::Posted { .. })
    ));
}

#[tokio::test]
async fn edits_share_new_mentions_and_emit_attachment_removals() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    let previous = messages::domain::models::MessageAttachment {
        id: Uuid::from_u128(4),
        entity_type: "document".into(),
        entity_id: Uuid::from_u128(3).to_string(),
        width: None,
        height: None,
        created_at: Utc::now(),
    };
    assert!(
        delivery
            .publish(event(MessageChange::Edited {
                notification_policy: Default::default(),
                message: message(),
                mentions: mentions(),
                previous_attachments: vec![previous]
            }))
            .await
            .is_err()
    );
    assert_eq!(*log.shares.lock().unwrap(), 1);
    let events = log.events.lock().unwrap();
    assert_eq!(events.len(), 1);
    let ChannelEvent::MessageCommitted { event, .. } = &events[0] else {
        panic!("missing committed message")
    };
    let MessageChange::Edited {
        message,
        previous_attachments,
        ..
    } = &event.change
    else {
        panic!("missing canonical edit")
    };
    assert!(message.attachments.is_empty());
    assert_eq!(previous_attachments.len(), 1);
    assert_eq!(previous_attachments[0].id, Uuid::from_u128(4));
}

#[tokio::test]
async fn reaction_add_and_remove_record_the_human_actor_activity() {
    let actor = "macro|reactor@example.com";
    let mut repo = MockChannelRepo::new();
    repo.expect_get_participants()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo.expect_upsert_activity()
        .withf(move |sender, channel| sender.as_ref() == actor && *channel == Uuid::from_u128(2))
        .times(2)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo, log.clone(), log.clone(), log.clone());
    for reactions in [
        vec![CountedReaction {
            emoji: "👍".into(),
            users: vec![actor.into()],
        }],
        vec![],
    ] {
        let mut message = message();
        message.reactions = reactions;
        let mut event = event(MessageChange::ReactionChanged { message });
        event.actor = actor.into();
        delivery.publish(event).await.unwrap();
    }
    assert_eq!(*log.live.lock().unwrap(), 2);
    assert!(log.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reaction_activity_failure_does_not_suppress_delivery() {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_participants()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo.expect_upsert_activity()
        .times(1)
        .returning(|_, _| Box::pin(async { anyhow::bail!("activity unavailable") }));
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo, log.clone(), log.clone(), log.clone());
    assert!(
        delivery
            .publish(event(MessageChange::ReactionChanged { message: message() }))
            .await
            .is_err()
    );
    assert_eq!(*log.live.lock().unwrap(), 1);
    assert!(log.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn bot_reactions_and_deletions_do_not_record_human_activity() {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_participants()
        .returning(|_| Box::pin(async { Ok(vec![]) }));
    repo.expect_upsert_activity().never();
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(repo, log.clone(), log.clone(), log.clone());
    let mut bot_event = event(MessageChange::ReactionChanged { message: message() });
    bot_event.actor = bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string();
    delivery.publish(bot_event).await.unwrap();
    let mut deleted = message();
    deleted.deleted_at = Some(Utc::now());
    delivery
        .publish(event(MessageChange::MessageDeleted { message: deleted }))
        .await
        .unwrap();
    assert_eq!(*log.live.lock().unwrap(), 2);
}

#[tokio::test]
async fn realtime_failure_does_not_suppress_channel_notification_and_search_events() {
    let log = Log {
        fail_live: true,
        ..Default::default()
    };
    let delivery = ChannelMessageDelivery::new(repo(), log.clone(), log.clone(), log.clone());
    assert!(
        delivery
            .publish(event(MessageChange::Posted {
                message: message(),
                mentions: vec![],
                notification_policy: Default::default()
            }))
            .await
            .is_err()
    );
    assert_eq!(*log.live.lock().unwrap(), 1);
    assert!(matches!(
        &log.events.lock().unwrap()[0],
        ChannelEvent::MessageCommitted {
            event,
            ..
        } if matches!(event.change, MessageChange::Posted { .. })
    ));
}
