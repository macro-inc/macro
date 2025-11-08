use crate::domain::models::{
    AggregateFrecency, AggregateId, EventRecord, FrecencyData, MAX_RECENT_EVENTS, TimestampWeight,
};
use chrono::DateTime;
use cool_asserts::assert_matches;
use model_entity::{Entity, EntityType, TrackAction, TrackingData};

fn create_event() -> EventRecord<'static> {
    EventRecord {
        event: TrackingData {
            entity: EntityType::Document
                .with_entity_str("my_document_id")
                .with_connection_str("my_connection")
                .with_user_str("macro|my_user@example.com"),
            action: TrackAction::Open,
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
