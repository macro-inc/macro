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
        completed_reply: None,
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
fn the_trigger_reads_messages_and_properties() {
    assert_eq!(
        MessageTriggerEvents::topics(),
        ["macro.messages", "macro.properties"]
    );
}

#[test]
fn a_task_joining_a_project_decodes_as_a_project_addition() {
    use initiative::domain::models::InitiativeId;
    use models_properties::{
        EntityType, service::property_value::PropertyValue, shared::EntityReference,
    };
    use properties::domain::events::EntityPropertyUpdatedMetadata;
    use system_properties::SystemPropertyKey;

    let project = InitiativeId::generate();
    let user = MacroUserIdStr::try_from_email("asker@example.com").unwrap();
    let event = PropertyMacroEvent::entity_property_updated(EntityPropertyUpdatedMetadata {
        entity_property_id: Uuid::now_v7(),
        entity_id: "task-a".to_owned(),
        entity_type: EntityType::Task,
        property_definition_id: SystemPropertyKey::PROJECT_UUID,
        actor_user_id: Some(user.clone()),
        actor: None,
        on_behalf_of: None,
        value: Some(PropertyValue::EntityRef(vec![EntityReference {
            entity_id: project.to_string(),
            entity_type: EntityType::Initiative,
            specific_message_id: None,
        }])),
        previous_value: None,
        updated_at: Utc::now(),
    });
    let decoded = MessageTriggerEvents::decode(&record(&event))
        .unwrap()
        .into_trigger();
    assert_eq!(decoded.event_type, "entity_property.updated");
    let added = decoded.project_task.unwrap();
    assert_eq!(added.task_id, "task-a");
    assert_eq!(added.project_id, project);
    assert_eq!(added.actor.actor.as_user(), Some(&user));
    assert!(decoded.assignment.is_none());
    assert!(decoded.posted.is_none());
}

#[test]
fn completed_bot_reply_mentions_reach_the_existing_trigger_path() {
    let posted = MessagePostedMetadata {
        parent: MessageParent::Channel(Uuid::from_u128(1)),
        message_id: Uuid::from_u128(2),
        thread_id: Some(Uuid::from_u128(3)),
        root_id: Uuid::from_u128(3),
        sender: ChannelSender::new_from_bot(bot_id::MACRO_NEW_BOT_ID),
        triggered_by: Some(sender().as_ref().to_owned()),
        content: "handoff".into(),
        mentions: vec![messages::domain::models::SimpleMention {
            entity_type: "bot".into(),
            entity_id: bot_id::CURSOR_BOT_ID.into_storage_id().to_string(),
        }],
        attachments: vec![],
        created_at: Utc::now(),
    };
    let patched = MessageMacroEvent::patched(messages::domain::events::MessagePatchedMetadata {
        completed_reply: Some(posted.clone()),
        parent: posted.parent.clone(),
        message_id: posted.message_id,
        thread_id: posted.thread_id,
        root_id: posted.root_id,
        actor: posted.sender.clone(),
        content: posted.content.clone(),
        edited_at: None,
        updated_at: Utc::now(),
    });
    let trigger = MessageTriggerEvents::decode(&record(&patched))
        .unwrap()
        .into_trigger();
    assert_eq!(trigger.posted.unwrap().posted, posted);

    let mut old_payload = serde_json::to_value(&patched.event().event).unwrap();
    old_payload["metadata"]
        .as_object_mut()
        .unwrap()
        .remove("completed_reply");
    let older: messages::outbound::broker::MessageTopicEvent =
        serde_json::from_value(old_payload).unwrap();
    assert!(
        matches!(older, messages::outbound::broker::MessageTopicEvent::Patched(p) if p.completed_reply.is_none())
    );
}
