use ::activity::Action;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::events::{CallRecordDeletedMetadata, CallStartedMetadata};

#[test]
fn call_started_yields_channel_and_call_activities() {
    let call_id = Uuid::from_u128(5);
    let channel_id = Uuid::from_u128(6);
    let created_at = Utc::now();
    let event = Event::with_event_id(
        Uuid::now_v7(),
        CallTopicEvent::Started(CallStartedMetadata {
            call_id,
            channel_id,
            created_by: MacroUserIdStr::try_from("macro|rahul@example.com".to_string()).unwrap(),
            created_at,
            recording_enabled: false,
        }),
    );

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities.len(), 2);
    assert_ne!(activities[0].id, activities[1].id);

    assert_eq!(activities[0].entity_type, EntityType::Channel);
    assert_eq!(activities[0].entity_id, channel_id.to_string());
    assert_eq!(
        activities[0].action,
        Action::CallStarted(::activity::CallStart {
            call_id: call_id.to_string()
        })
    );

    assert_eq!(activities[1].entity_type, EntityType::Call);
    assert_eq!(activities[1].entity_id, call_id.to_string());
    assert_eq!(activities[1].action, Action::Created);
    assert!(activities.iter().all(|a| a.occurred_at == created_at));
}

#[test]
fn record_deletion_purges_the_call() {
    let call_id = Uuid::from_u128(5);
    let event = Event::with_event_id(
        Uuid::now_v7(),
        CallTopicEvent::RecordDeleted(CallRecordDeletedMetadata {
            call_id,
            channel_id: Uuid::from_u128(6),
            actor_user_id: None,
        }),
    );

    assert_eq!(
        event.event.ingest(event.event_id),
        Ingest::Purge(vec![(EntityType::Call, call_id.to_string())])
    );
}
