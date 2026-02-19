use crate::domain::models::{
    AggregateFrecency, AggregateId, EventRecord, FrecencyAction, FrecencyData, FrecencyEntity,
    FrecencyEvent, MAX_RECENT_EVENTS, TimestampWeight,
};
use chrono::DateTime;
use cool_asserts::assert_matches;
use model_entity::{Entity, EntityType};
use std::borrow::Cow;

fn create_event() -> EventRecord<'static> {
    EventRecord {
        event: FrecencyEvent {
            entity: FrecencyEntity {
                user_id: Cow::Borrowed("macro|my_user@example.com"),
                entity: EntityType::Document.with_entity_str("my_document_id"),
            },
            action: FrecencyAction::Open,
        },
        timestamp: DateTime::UNIX_EPOCH,
    }
}

#[test]
fn it_creates_aggregate() {
    let aggregate =
        AggregateFrecency::new_from_initial_action(create_event(), DateTime::UNIX_EPOCH).unwrap();

    assert_matches!(aggregate, AggregateFrecency { id: AggregateId { entity: Entity { entity_type: EntityType::Document, entity_id, .. }, user_id }, data: FrecencyData {event_count: 1, frecency_score: _, first_event, recent_events} } => {
        assert_eq!(first_event, DateTime::UNIX_EPOCH);
        assert_matches!(recent_events, [TimestampWeight { weight: _, timestamp }] => {
            assert_eq!(timestamp, DateTime::UNIX_EPOCH);
        });
        assert_eq!(user_id.as_ref(), "macro|my_user@example.com");
        assert_eq!(entity_id, "my_document_id");
    });
}

#[test]
fn it_appends_to_existing() {
    let aggregate =
        AggregateFrecency::new_from_initial_action(create_event(), DateTime::UNIX_EPOCH)
            .unwrap()
            .append_event(&create_event(), DateTime::UNIX_EPOCH);

    assert_matches!(aggregate, AggregateFrecency { data: FrecencyData { event_count: 2, recent_events, ..  }, .. } => {
        assert_eq!(recent_events.len(), 2)
    })
}

#[test]
fn it_trims_above_max_events() {
    let create_events = MAX_RECENT_EVENTS + 5;
    let aggregate = Some(create_event())
        .into_iter()
        .cycle()
        .take(create_events)
        .fold(
            AggregateFrecency::new_from_initial_action(create_event(), DateTime::UNIX_EPOCH)
                .unwrap(),
            |acc, cur| acc.append_event(&cur, DateTime::UNIX_EPOCH),
        );
    assert_matches!(aggregate, AggregateFrecency { data: FrecencyData { event_count, recent_events, .. }, .. } => {
        assert_eq!(recent_events.len(), MAX_RECENT_EVENTS);
        assert_eq!(event_count, create_events + 1); // plus 1 for the initial event
    })
}

#[test]
fn old_tracking_data_deserializes_to_frecency_event() {
    // Old TrackingData format: {"entity": {...nested UserEntityConnection...}, "action": "..."}
    let old_json = serde_json::json!({
        "entity": {
            "user_id": "macro|test@example.com",
            "entity_type": "document",
            "entity_id": "doc-123",
            "connection_id": "conn-456"  // This field will be ignored
        },
        "action": "open"
    });

    // Should deserialize successfully, ignoring connection_id
    let event: FrecencyEvent<'static> = serde_json::from_value(old_json).unwrap();
    assert_eq!(event.entity.user_id, "macro|test@example.com");
    assert_eq!(event.entity.entity.entity_type, EntityType::Document);
    assert_eq!(event.entity.entity.entity_id, "doc-123");
    assert!(matches!(event.action, FrecencyAction::Open));
}

#[test]
fn frecency_event_serializes_without_connection_id() {
    let event = FrecencyEvent {
        entity: FrecencyEntity {
            user_id: Cow::Borrowed("macro|test@example.com"),
            entity: EntityType::Document.with_entity_str("doc-123"),
        },
        action: FrecencyAction::Open,
    };

    let json = serde_json::to_value(&event).unwrap();

    // Should NOT have connection_id in the output
    assert!(json.get("entity").unwrap().get("connection_id").is_none());
    assert_eq!(
        json.get("entity").unwrap().get("user_id").unwrap(),
        "macro|test@example.com"
    );
    assert_eq!(
        json.get("entity").unwrap().get("entity_type").unwrap(),
        "document"
    );
    assert_eq!(
        json.get("entity").unwrap().get("entity_id").unwrap(),
        "doc-123"
    );
    assert_eq!(json.get("action").unwrap(), "open");
}
