use ::activity::{Action, activity_id};
use chrono::{TimeZone as _, Utc};
use macro_event_broker::Event;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use super::*;
use crate::domain::events::{
    Attribution as EventAttribution, DatabaseCreatedMetadata, DatabasePurgedMetadata,
    DatabaseRenamedMetadata, DatabaseRestoredMetadata, DatabaseTablesChangedMetadata,
    DatabaseTrashedMetadata, TableVersionChange,
};
use crate::domain::models::TableVersion;

const DATABASE_ID: &str = "11111111-1111-1111-1111-111111111111";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: DatabaseTopicEvent) -> Event<DatabaseTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

fn single_activity(ingest: Ingest) -> Activity {
    match ingest {
        Ingest::Insert(mut activities) => {
            assert_eq!(activities.len(), 1);
            activities.pop().unwrap()
        }
        other => panic!("expected a single activity, got {other:?}"),
    }
}

fn by_user(id: &str) -> Option<EventAttribution> {
    Some(EventAttribution::user(user(id)))
}

#[test]
fn created_maps_to_a_created_activity_at_the_repository_timestamp() {
    let created_at = Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap();
    let event = envelope(DatabaseTopicEvent::Created(DatabaseCreatedMetadata {
        database_id: DATABASE_ID.to_string(),
        owner: user("macro|creator@example.com"),
        name: "Roadmap".to_string(),
        created_at,
    }));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Created);
    assert_eq!(activity.entity_type, EntityType::Database);
    assert_eq!(activity.entity_id, DATABASE_ID);
    assert_eq!(activity.subject_id, "macro|creator@example.com");
    assert_eq!(activity.actor.as_ref(), "macro|creator@example.com");
    assert_eq!(activity.occurred_at, created_at);
    assert_eq!(activity.id, activity_id(event.event_id, 0));
}

#[test]
fn renamed_restored_and_tables_changed_map_to_edited() {
    let events = [
        DatabaseTopicEvent::Renamed(DatabaseRenamedMetadata {
            database_id: DATABASE_ID.to_string(),
            attribution: by_user("macro|editor@example.com"),
            name: "Renamed".to_string(),
        }),
        DatabaseTopicEvent::Restored(DatabaseRestoredMetadata {
            database_id: DATABASE_ID.to_string(),
            attribution: by_user("macro|editor@example.com"),
        }),
        DatabaseTopicEvent::TablesChanged(DatabaseTablesChangedMetadata {
            database_id: DATABASE_ID.to_string(),
            attribution: by_user("macro|editor@example.com"),
            tables: vec![TableVersionChange {
                table_id: Uuid::new_v4(),
                version: TableVersion(3),
            }],
        }),
    ];

    for event in events {
        let event = envelope(event);
        let activity = single_activity(event.event.ingest(event.event_id));
        assert_eq!(activity.action, Action::Edited, "{:?}", event.event);
        assert_eq!(activity.entity_type, EntityType::Database);
        assert_eq!(activity.entity_id, DATABASE_ID);
        assert_eq!(activity.subject_id, "macro|editor@example.com");
    }
}

#[test]
fn trashed_maps_to_deleted() {
    let event = envelope(DatabaseTopicEvent::Trashed(DatabaseTrashedMetadata {
        database_id: DATABASE_ID.to_string(),
        attribution: by_user("macro|owner@example.com"),
    }));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Deleted);
    assert_eq!(activity.subject_id, "macro|owner@example.com");
}

#[test]
fn delegated_writes_land_on_the_subjects_feed() {
    let bot = Actor::try_from("bot|00000000-0000-0000-0000-000000000042".to_string())
        .expect("valid bot actor");
    let event = envelope(DatabaseTopicEvent::TablesChanged(
        DatabaseTablesChangedMetadata {
            database_id: DATABASE_ID.to_string(),
            attribution: Some(EventAttribution {
                actor: bot.clone(),
                on_behalf_of: Some(user("macro|asker@example.com")),
            }),
            tables: vec![],
        },
    ));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.actor, bot);
    assert_eq!(activity.subject_id, "macro|asker@example.com");
}

#[test]
fn unattributed_mutations_are_ignored() {
    let event = envelope(DatabaseTopicEvent::Renamed(DatabaseRenamedMetadata {
        database_id: DATABASE_ID.to_string(),
        attribution: None,
        name: "Internal".to_string(),
    }));

    assert_eq!(event.event.ingest(event.event_id), Ingest::Ignore);
}

#[test]
fn purged_purges_the_database() {
    let event = envelope(DatabaseTopicEvent::Purged(DatabasePurgedMetadata {
        database_id: DATABASE_ID.to_string(),
    }));

    assert_eq!(
        event.event.ingest(event.event_id),
        Ingest::Purge(vec![(EntityType::Database, DATABASE_ID.to_string())])
    );
}

#[test]
fn events_round_trip_through_json() {
    let event = DatabaseTopicEvent::TablesChanged(DatabaseTablesChangedMetadata {
        database_id: DATABASE_ID.to_string(),
        attribution: by_user("macro|editor@example.com"),
        tables: vec![TableVersionChange {
            table_id: Uuid::new_v4(),
            version: TableVersion(7),
        }],
    });

    let json = serde_json::to_value(&event).expect("serializes");
    assert_eq!(json["event_type"], "database.tables_changed");
    let decoded: DatabaseTopicEvent = serde_json::from_value(json).expect("deserializes");
    assert_eq!(decoded, event);
}
