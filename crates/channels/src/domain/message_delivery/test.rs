use super::*;
use crate::domain::{
    models::{
        ChannelInfo, ChannelParticipant, ChannelType, ParticipantRole, ReferencedShareItemType,
    },
    ports::MockChannelRepo,
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::{MessageAttachment, SimpleMention};
use std::time::Duration;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

/// Who shared which item ids.
type Share = (String, Vec<String>);

#[derive(Clone, Default)]
struct Log {
    events: Arc<Mutex<Vec<ChannelEvent>>>,
    live: Arc<Mutex<Vec<(String, HashSet<String>)>>>,
    shares: Arc<Mutex<Vec<Share>>>,
    shared: Arc<tokio::sync::Notify>,
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
        actor: MacroUserIdStr<'static>,
        _: Uuid,
        items: Vec<ReferencedShareItem>,
    ) -> Result<Vec<crate::domain::models::ReferenceShareResult>, Self::Err> {
        self.shares.lock().unwrap().push((
            actor.to_string(),
            items
                .iter()
                .map(|item| item.entity_id().to_owned())
                .collect(),
        ));
        self.shared.notify_one();
        anyhow::bail!("sharing temporarily unavailable")
    }
}

/// What bots created for MEMBER, who asked in the thread when `asked` is set.
#[derive(Clone, Default)]
struct Creations {
    asked: bool,
    created: Arc<Mutex<Vec<(BotId, ReferencedShareItem)>>>,
    lookups: Arc<Mutex<usize>>,
}

impl AgentCreations for Creations {
    type Err = anyhow::Error;
    async fn request_sent_at(
        &self,
        thread_root: Uuid,
        person: &MacroUserIdStr<'static>,
        _: DateTime<Utc>,
    ) -> Result<Option<DateTime<Utc>>, Self::Err> {
        assert_eq!(
            thread_root,
            Uuid::from_u128(1),
            "the root message is the thread"
        );
        assert_eq!(person.as_ref(), MEMBER);
        Ok(self.asked.then(Utc::now))
    }
    async fn created_since(
        &self,
        bot: BotId,
        _: &MacroUserIdStr<'static>,
        _: DateTime<Utc>,
        items: Vec<ReferencedShareItem>,
    ) -> Result<Vec<ReferencedShareItem>, Self::Err> {
        *self.lookups.lock().unwrap() += 1;
        let created = self.created.lock().unwrap();
        Ok(items
            .into_iter()
            .filter(|item| created.contains(&(bot, item.clone())))
            .collect())
    }
}

const CHANNEL: Uuid = Uuid::from_u128(2);
const MEMBER: &str = "macro|member@example.com";
const SENDER: &str = "macro|sender@example.com";
const BOT: &str = "bot|00000000-0000-0000-0000-00000000b07a";
const DOCUMENT: Uuid = Uuid::from_u128(3);
const EXISTING_DOCUMENT: Uuid = Uuid::from_u128(8);

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
        triggered_via: None,
        triggered_by: None,
        bot_profile: None,
        mentions: vec![],
        guest_name: None,
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
async fn a_post_emits_the_channel_notification_event_and_the_common_payload() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
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
    assert_eq!(
        *log.shares.lock().unwrap(),
        [(
            SENDER.to_owned(),
            vec![DOCUMENT.to_string(), DOCUMENT.to_string()]
        )],
        "a person shares everything they link"
    );
    let events = log.events.lock().unwrap();
    let [
        ChannelEvent::MessagePosted {
            channel_id,
            message,
            has_attachments,
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
    assert_eq!(participants.len(), 2);
    assert_eq!(
        *log.live.lock().unwrap(),
        vec![("posted".to_owned(), live_users())]
    );
}

#[tokio::test]
async fn an_edit_that_notifies_as_a_post_emits_the_posted_event() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
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
        ChannelEvent::MessagePosted {
            notification_policy,
            ..
        },
    ] = events.as_slice()
    else {
        panic!("expected one posted event, got {events:?}");
    };
    assert_eq!(*notification_policy, PostMessageNotificationPolicy::Default);
    assert_eq!(log.live.lock().unwrap()[0].0, "edited");
}

#[tokio::test]
async fn plain_edits_deletions_reactions_and_typing_only_send_the_common_payload() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
    for change in [
        MessageChange::Edited {
            notification_policy: PatchMessageNotificationPolicy::Default,
            message: message(),
            mentions: vec![],
            previous_attachments: vec![],
        },
        MessageChange::MessageDeleted { message: message() },
        MessageChange::ReactionChanged {
            message: message(),
            emoji: "👍".to_string(),
            added: true,
        },
        MessageChange::Typing {
            thread_id: Some(Uuid::from_u128(9)),
            active: false,
            agent: None,
        },
    ] {
        // The plain edit still records sharing, whose failure is reported.
        let _ = delivery.publish(event(change)).await;
    }
    assert!(log.events.lock().unwrap().is_empty());
    assert_eq!(
        log.live
            .lock()
            .unwrap()
            .iter()
            .map(|(kind, _)| kind.as_str())
            .collect::<Vec<_>>(),
        ["edited", "message_deleted", "reaction_changed", "typing"]
    );
}

#[tokio::test]
async fn added_reaction_carries_author_notification_context() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
    let mut reaction = event(MessageChange::ReactionChanged {
        message: message(),
        emoji: "👍".to_string(),
        added: true,
    });
    reaction.actor = MEMBER.to_owned();

    delivery.publish(reaction).await.unwrap();

    let events = log.events.lock().unwrap();
    let [ChannelEvent::ReactionAdded { notification, .. }] = events.as_slice() else {
        panic!("expected reaction notification context, got {events:?}");
    };
    assert_eq!(notification.emoji, "👍");
    assert_eq!(notification.message_content, "Message");
    assert_eq!(notification.metadata.channel_name, "Test");
}

#[tokio::test]
async fn removed_reaction_sends_no_author_notification() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
    let mut reaction = event(MessageChange::ReactionChanged {
        message: message(),
        emoji: "👍".to_string(),
        added: false,
    });
    reaction.actor = MEMBER.to_owned();

    delivery.publish(reaction).await.unwrap();

    assert!(log.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn thread_updates_stay_off_the_channel_side_effect_path() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
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
async fn realtime_failure_is_reported() {
    let log = Log {
        fail_live: true,
        ..Default::default()
    };
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
    assert!(
        delivery
            .publish(event(MessageChange::MessageDeleted { message: message() }))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn document_events_are_rejected() {
    let log = Log::default();
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        Creations::default(),
    );
    let mut event = event(MessageChange::MessageDeleted { message: message() });
    event.parent = MessageParent::parse("document", "doc").unwrap();
    assert!(delivery.publish(event).await.is_err());
    assert!(log.events.lock().unwrap().is_empty());
}

fn document(id: Uuid) -> ReferencedShareItem {
    ReferencedShareItem::new(id.to_string(), ReferencedShareItemType::Document)
}

/// The agent's post for MEMBER linking the attached DOCUMENT and EXISTING_DOCUMENT.
fn agent_post(triggered_by: Option<&str>) -> MessageEvent {
    let mut posted = event(MessageChange::Posted {
        notification_policy: Default::default(),
        message: Message {
            sender_id: BOT.to_owned().try_into().unwrap(),
            triggered_by: triggered_by.map(str::to_owned),
            ..message()
        },
        mentions: vec![SimpleMention {
            entity_type: "document".into(),
            entity_id: EXISTING_DOCUMENT.to_string(),
        }],
    });
    posted.actor = BOT.to_owned();
    posted
}

/// MEMBER asked in the thread, and `bot` created `items` for them since.
fn asked_and(bot: BotId, items: Vec<ReferencedShareItem>) -> Creations {
    Creations {
        asked: true,
        created: Arc::new(Mutex::new(
            items.into_iter().map(|item| (bot, item)).collect(),
        )),
        ..Default::default()
    }
}

#[tokio::test(start_paused = true)]
async fn an_agent_shares_what_it_created_for_the_request_and_not_what_already_existed() {
    let log = Log::default();
    let creations = asked_and(BotId::TEST_A, vec![document(DOCUMENT)]);
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        creations.clone(),
    );

    let _ = delivery.publish(agent_post(Some(MEMBER))).await;
    // Let every background re-check for the existing document run out.
    tokio::time::sleep(Duration::from_secs(60)).await;

    assert_eq!(
        *log.shares.lock().unwrap(),
        [(MEMBER.to_owned(), vec![DOCUMENT.to_string()])]
    );
    assert_eq!(
        *creations.lookups.lock().unwrap(),
        3,
        "one lookup and two re-checks"
    );
}

#[tokio::test(start_paused = true)]
async fn a_creation_recorded_after_delivery_is_shared_by_the_re_check() {
    let log = Log::default();
    let creations = asked_and(BotId::TEST_A, vec![]);
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        creations.clone(),
    );

    delivery.publish(agent_post(Some(MEMBER))).await.unwrap();
    assert!(log.shares.lock().unwrap().is_empty());
    creations
        .created
        .lock()
        .unwrap()
        .push((BotId::TEST_A, document(DOCUMENT)));
    log.shared.notified().await;

    assert_eq!(
        *log.shares.lock().unwrap(),
        [(MEMBER.to_owned(), vec![DOCUMENT.to_string()])]
    );
}

#[tokio::test(start_paused = true)]
async fn what_another_bot_created_is_not_shared() {
    let log = Log::default();
    let creations = asked_and(BotId::TEST_B, vec![document(DOCUMENT)]);
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        creations.clone(),
    );

    delivery.publish(agent_post(Some(MEMBER))).await.unwrap();
    tokio::time::sleep(Duration::from_secs(60)).await;

    assert!(log.shares.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_reply_to_no_request_from_the_person_shares_nothing() {
    let log = Log::default();
    let creations = Creations {
        asked: false,
        ..asked_and(BotId::TEST_A, vec![document(DOCUMENT)])
    };
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        creations.clone(),
    );

    delivery.publish(agent_post(Some(MEMBER))).await.unwrap();
    tokio::time::sleep(Duration::from_secs(60)).await;

    assert!(log.shares.lock().unwrap().is_empty());
    assert_eq!(*creations.lookups.lock().unwrap(), 0);
}

#[tokio::test(start_paused = true)]
async fn an_agent_post_for_nobody_shares_nothing() {
    let log = Log::default();
    let creations = asked_and(BotId::TEST_A, vec![document(DOCUMENT)]);
    let delivery = ChannelMessageDelivery::new(
        repo(),
        log.clone(),
        log.clone(),
        log.clone(),
        creations.clone(),
    );

    delivery.publish(agent_post(None)).await.unwrap();
    tokio::time::sleep(Duration::from_secs(60)).await;

    assert!(log.shares.lock().unwrap().is_empty());
}
