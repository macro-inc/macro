use super::*;
use crate::domain::{
    models::{Message, MessageAttachment, MessageParent, SimpleMention},
    ports::{MessageChange, MessageEvent, MessageEventPublisher},
};
use chrono::Utc;
use macro_event_broker::{EventBrokerError, MacroEventBroker};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct RecordingBroker {
    published: Arc<Mutex<Vec<(String, String, serde_json::Value)>>>,
}

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published.lock().unwrap().push((
            event.topic().to_owned(),
            event.key().to_owned(),
            serde_json::to_value(event.event())?,
        ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

const ROOT: Uuid = Uuid::from_u128(1);
const REPLY: Uuid = Uuid::from_u128(2);
const SENDER: &str = "macro|author@example.com";

fn attachment(id: u128) -> MessageAttachment {
    MessageAttachment {
        id: Uuid::from_u128(id),
        entity_type: "document".into(),
        entity_id: Uuid::from_u128(id + 100).to_string(),
        width: None,
        height: None,
        created_at: Utc::now(),
    }
}

fn reply(parent: MessageParent, attachments: Vec<MessageAttachment>) -> Message {
    Message {
        id: REPLY,
        parent,
        thread_id: Some(ROOT),
        sender_id: SENDER.to_owned().try_into().unwrap(),
        imported_author: None,
        bot_profile: None,
        mentions: vec![],
        triggered_by: None,
        content: "hello @someone".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments,
        reactions: vec![],
    }
}

fn event(parent: MessageParent, change: MessageChange) -> MessageEvent {
    MessageEvent {
        parent,
        actor: SENDER.into(),
        nonce: None,
        change,
    }
}

fn mention(kind: &str, id: &str) -> SimpleMention {
    SimpleMention {
        entity_type: kind.into(),
        entity_id: id.into(),
    }
}

async fn publish(
    parent: MessageParent,
    change: MessageChange,
) -> Vec<(String, String, serde_json::Value)> {
    let broker = RecordingBroker::default();
    BrokerMessagePublisher::new(broker.clone())
        .publish(event(parent, change))
        .await
        .unwrap();
    broker.published.lock().unwrap().clone()
}

fn event_types(published: &[(String, String, serde_json::Value)]) -> Vec<String> {
    published
        .iter()
        .map(|(_, _, payload)| payload["event_type"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn a_post_publishes_posted_attachment_and_one_mention_per_entity_for_both_parents() {
    for parent in [
        MessageParent::Channel(Uuid::from_u128(20)),
        MessageParent::parse("document", "legacy-doc").unwrap(),
    ] {
        let published = publish(
            parent.clone(),
            MessageChange::Posted {
                notification_policy: Default::default(),
                message: reply(parent.clone(), vec![attachment(5)]),
                mentions: vec![
                    mention("user", "macro|a@example.com"),
                    mention("document", "doc"),
                    mention("user", "macro|a@example.com"),
                ],
            },
        )
        .await;
        assert_eq!(
            event_types(&published),
            [
                "message.posted",
                "message.attachment_created",
                "message.mentioned",
                "message.mentioned",
            ]
        );
        assert!(
            published
                .iter()
                .all(|(topic, key, _)| { *topic == "macro.messages" && *key == ROOT.to_string() })
        );
        let posted = &published[0].2["metadata"];
        assert_eq!(posted["parent"], serde_json::to_value(&parent).unwrap());
        assert_eq!(posted["message_id"], REPLY.to_string());
        assert_eq!(posted["thread_id"], ROOT.to_string());
        assert_eq!(posted["root_id"], ROOT.to_string());
        assert_eq!(posted["sender"], SENDER);
        assert_eq!(posted["mentions"].as_array().unwrap().len(), 3);
        assert_eq!(
            posted["attachments"][0]["attachment_id"],
            Uuid::from_u128(5).to_string()
        );
        assert_eq!(
            published[2].2["metadata"]["mentioned"]["entity_id"],
            "macro|a@example.com"
        );
        assert_eq!(
            published[3].2["metadata"]["mentioned"]["entity_type"],
            "document"
        );
        let round_trip: MessageTopicEvent = serde_json::from_value(published[0].2.clone()).unwrap();
        assert!(matches!(round_trip, MessageTopicEvent::Posted(_)));
    }
}

#[tokio::test]
async fn an_edit_publishes_patched_and_attachment_deltas() {
    let parent = MessageParent::parse("document", "legacy-doc").unwrap();
    let mut edited = reply(parent.clone(), vec![attachment(5), attachment(6)]);
    edited.edited_at = Some(Utc::now());
    let published = publish(
        parent,
        MessageChange::Edited {
            notification_policy: Default::default(),
            message: edited,
            mentions: vec![mention("user", "macro|a@example.com")],
            previous_attachments: vec![attachment(6), attachment(7)],
        },
    )
    .await;
    assert_eq!(
        event_types(&published),
        [
            "message.patched",
            "message.attachment_created",
            "message.attachment_removed",
        ]
    );
    assert!(published[0].2["metadata"]["edited_at"].is_string());
    assert_eq!(published[0].2["metadata"]["actor"], SENDER);
    assert_eq!(
        published[1].2["metadata"]["attachments"][0]["attachment_id"],
        Uuid::from_u128(5).to_string()
    );
    assert_eq!(
        published[2].2["metadata"]["attachments"][0]["attachment_id"],
        Uuid::from_u128(7).to_string()
    );
}

#[tokio::test]
async fn deletions_publish_and_reactions_typing_and_thread_state_stay_off_the_topic() {
    let parent = MessageParent::Channel(Uuid::from_u128(20));
    let mut deleted = reply(parent.clone(), vec![]);
    deleted.deleted_at = Some(Utc::now());
    let published = publish(
        parent.clone(),
        MessageChange::MessageDeleted { message: deleted },
    )
    .await;
    assert_eq!(event_types(&published), ["message.deleted"]);
    assert_eq!(published[0].2["metadata"]["root_id"], ROOT.to_string());
    for change in [
        MessageChange::ReactionChanged {
            message: reply(parent.clone(), vec![]),
        },
        MessageChange::Typing {
            thread_id: Some(ROOT),
            active: true,
        },
        MessageChange::ThreadUpdated {
            state: crate::domain::models::ThreadState {
                root_id: ROOT,
                user_id: SENDER.into(),
                resolved: true,
                anchor: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                deleted_at: None,
            },
        },
    ] {
        assert!(publish(parent.clone(), change).await.is_empty());
    }
}
