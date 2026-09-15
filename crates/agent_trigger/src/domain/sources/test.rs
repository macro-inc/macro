use super::*;
use channel_sender::ChannelSender;
use channels::domain::broker_events::{ChannelEventAttachment, ChannelMessagePostedMetadata};
use channels::domain::models::ChannelType;
use chrono::Utc;
use macro_event_broker::{Event, MacroEvent as _, MessageParts};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::events::MessagePostedMetadata;
use messages::domain::models::{MessageParent, SimpleMention};

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

fn channel_post(thread_id: Option<Uuid>) -> ChannelMessagePostedMetadata {
    ChannelMessagePostedMetadata {
        channel_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
        thread_id,
        sender: sender(),
        triggered_by: None,
        channel_type: ChannelType::Public,
        content: "@claude fix it".to_owned(),
        mentions: vec![SimpleMention {
            entity_type: "bot".to_owned(),
            entity_id: "bot|00000000-0000-0000-0000-00000000b07a".to_owned(),
        }],
        attachments: vec![ChannelEventAttachment {
            attachment_id: Uuid::from_u128(9),
            entity_type: "document".to_owned(),
            entity_id: "doc".to_owned(),
            created_at: Utc::now(),
        }],
        created_at: Utc::now(),
    }
}

#[test]
fn a_channel_post_decodes_as_a_channel_parent_rooted_like_the_message_service() {
    let top_level = posted_from_channel_event(&channel_post(None));
    assert_eq!(top_level.parent, MessageParent::Channel(Uuid::from_u128(1)));
    assert_eq!(top_level.root_id, top_level.message_id);
    assert_eq!(top_level.mentions.len(), 1);
    assert_eq!(top_level.attachments[0].attachment_id, Uuid::from_u128(9));

    let reply = posted_from_channel_event(&channel_post(Some(Uuid::from_u128(7))));
    assert_eq!(reply.root_id, Uuid::from_u128(7));
    assert_eq!(reply.thread_id, Some(Uuid::from_u128(7)));
}

/// The channel source already knows the channel's type, so the trigger need
/// not look it up to publish the channel-only wire shape.
#[test]
fn the_channel_source_only_triggers_on_posts() {
    let posted = ChannelMacroEvent::from_event(
        "1".to_owned(),
        Event::new(ChannelTopicEvent::MessagePosted(channel_post(None))),
    );
    let decoded = ChannelTriggerEvents::decode(&record(&posted)).unwrap();
    let trigger = decoded.into_trigger();
    assert_eq!(trigger.event_type, "channel.message_posted");
    let input = trigger.posted.unwrap();
    assert_eq!(
        input.posted.parent,
        MessageParent::Channel(Uuid::from_u128(1))
    );
    assert_eq!(input.channel_type, Some(ChannelType::Public));

    let deleted = ChannelMacroEvent::from_event(
        "1".to_owned(),
        Event::new(ChannelTopicEvent::MessageDeleted(
            channels::domain::broker_events::ChannelMessageDeletedMetadata {
                channel_id: Uuid::from_u128(1),
                message_id: Uuid::from_u128(2),
                thread_id: None,
                actor: sender(),
                deleted_at: None,
            },
        )),
    );
    let trigger = ChannelTriggerEvents::decode(&record(&deleted))
        .unwrap()
        .into_trigger();
    assert_eq!(trigger.event_type, "channel.message_deleted");
    assert!(trigger.posted.is_none());
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
fn each_source_reads_exactly_one_topic() {
    assert_eq!(MessageTriggerEvents::topics(), ["macro.messages"]);
    assert_eq!(ChannelTriggerEvents::topics(), ["macro.channels"]);
    assert_eq!(
        "channels".parse::<TriggerEventSource>().unwrap(),
        TriggerEventSource::Channels
    );
    assert_eq!(
        "MESSAGES".parse::<TriggerEventSource>().unwrap(),
        TriggerEventSource::Messages
    );
    assert!("both".parse::<TriggerEventSource>().is_err());
    assert_eq!(TriggerEventSource::default(), TriggerEventSource::Messages);
}
