use super::*;
use channel_sender::ChannelSender;
use chrono::Utc;
use macro_event_broker::MessageParts;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::events::MessagePostedMetadata;
use messages::domain::models::MessageParent;

struct Record {
    topic: &'static str,
    key: String,
    payload: Vec<u8>,
}

impl MessageParts for Record {
    fn key(&self) -> Option<&str> {
        Some(&self.key)
    }
    fn payload(&self) -> Option<&[u8]> {
        Some(&self.payload)
    }
    fn topic(&self) -> &str {
        self.topic
    }
}

fn record<E: macro_event_broker::MacroEvent>(event: &E) -> Record
where
    E::EventPayload: serde::Serialize,
{
    Record {
        topic: <<E::EventPayload as macro_event_broker::TopicEvent>::Topic as macro_event_broker::Topic>::TOPIC_STR,
        key: event.key().to_owned(),
        payload: serde_json::to_vec(event.event()).unwrap(),
    }
}

fn sender() -> ChannelSender<'static> {
    ChannelSender::new_from_user(MacroUserIdStr::try_from_email("asker@example.com").unwrap())
}

#[test]
fn the_message_source_carries_the_persisted_parent_through() {
    let posted = MessagePostedMetadata {
        parent: MessageParent::parse("document", "doc-1").unwrap(),
        message_id: Uuid::from_u128(2),
        thread_id: None,
        root_id: Uuid::from_u128(2),
        sender: sender(),
        triggered_by: None,
        content: "@claude explain".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    };
    let event = MessageMacroEvent::posted(posted.clone());
    let trigger = MessageTriggerEvents::decode(&record(&event))
        .unwrap()
        .into_trigger();
    assert_eq!(trigger.event_type, "message.posted");
    assert_eq!(
        trigger.posted,
        Some(TriggerInput {
            posted,
            channel_type: None,
        })
    );

    let patched = MessageMacroEvent::patched(messages::domain::events::MessagePatchedMetadata {
        parent: MessageParent::parse("document", "doc-1").unwrap(),
        message_id: Uuid::from_u128(2),
        thread_id: None,
        root_id: Uuid::from_u128(2),
        actor: sender(),
        content: "edited".to_owned(),
        edited_at: None,
        updated_at: Utc::now(),
    });
    let trigger = MessageTriggerEvents::decode(&record(&patched))
        .unwrap()
        .into_trigger();
    assert_eq!(trigger.event_type, "message.patched");
    assert!(trigger.posted.is_none());
}

#[test]
fn the_trigger_reads_the_messages_topic() {
    assert_eq!(MessageTriggerEvents::topics(), ["macro.messages"]);
}
