use macro_event_broker::exposure::{Audience, EntityType, Exposure, PublicEvent, Stage};
use serde_json::json;
use uuid::Uuid;

use super::*;

const DATABASE_ID: &str = "00000000-0000-0000-0000-000000000001";

fn database_id() -> DatabaseId {
    DatabaseId::from_uuid(Uuid::from_u128(1))
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()
}

fn public(event: &DatabaseTopicEvent) -> PublicEvent<'_, DatabasePublicEvent> {
    match event.exposure().unwrap() {
        Exposure::Public(public) => public,
        Exposure::Internal(reason) => panic!("expected public, got {reason}"),
    }
}

fn tables_changed() -> DatabaseTopicEvent {
    DatabaseTopicEvent::TablesChanged(DatabaseTablesChangedMetadata {
        database_id: database_id(),
        attribution: Some(Attribution::acting(
            owner(),
            Some(BotId::new_from_uuid(Uuid::from_u128(2))),
        )),
        tables: vec![TableVersionChange {
            table_id: TableId::from_uuid(Uuid::from_u128(3)),
            version: TableVersion(7),
        }],
    })
}

#[test]
fn database_events_reach_the_database_audience_in_preview() {
    let events = [
        DatabaseTopicEvent::Created(DatabaseCreatedMetadata {
            database_id: database_id(),
            owner: owner(),
            name: "Customers".to_owned(),
            created_at: "2026-11-13T00:00:00Z".parse().unwrap(),
            attribution: Attribution::user(owner()),
        }),
        DatabaseTopicEvent::Renamed(DatabaseRenamedMetadata {
            database_id: database_id(),
            attribution: None,
            name: "Renamed".to_owned(),
        }),
        DatabaseTopicEvent::Trashed(DatabaseTrashedMetadata {
            database_id: database_id(),
            attribution: None,
        }),
        DatabaseTopicEvent::Restored(DatabaseRestoredMetadata {
            database_id: database_id(),
            attribution: None,
        }),
        tables_changed(),
        DatabaseTopicEvent::SharingChanged(DatabaseSharingChangedMetadata {
            database_id: database_id(),
            attribution: None,
        }),
        DatabaseTopicEvent::AppearanceChanged {
            database_id: database_id(),
            attribution: None,
            change: activity::AppearanceChange {
                from: None,
                to: None,
            },
        },
    ];
    for event in &events {
        let public = public(event);
        assert_eq!(
            public.audience,
            Audience::Entity {
                entity_type: EntityType::Database,
                entity_id: DATABASE_ID.to_owned(),
            },
            "{}",
            public.name
        );
        assert_eq!(public.entity.entity_type.as_str(), "database");
        assert_eq!(public.stage, Stage::Preview);
        assert_eq!(
            serde_json::to_value(public.payload.as_ref()).unwrap()["event_type"],
            public.name
        );
    }
}

#[test]
fn renamed_payload_omits_the_name() {
    let event = DatabaseTopicEvent::Renamed(DatabaseRenamedMetadata {
        database_id: database_id(),
        attribution: Some(Attribution::user(owner())),
        name: "Secret".to_owned(),
    });
    assert_eq!(
        serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
        json!({
            "event_type": "database.renamed",
            "metadata": {
                "database_id": DATABASE_ID,
                "actor": "macro|owner@example.com",
                "on_behalf_of": null,
            },
        })
    );
}

#[test]
fn tables_changed_payload_lists_table_versions() {
    let event = tables_changed();
    assert_eq!(
        serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
        json!({
            "event_type": "database.tables_changed",
            "metadata": {
                "database_id": DATABASE_ID,
                "actor": "bot|00000000-0000-0000-0000-000000000002",
                "on_behalf_of": "macro|owner@example.com",
                "tables": [{
                    "table_id": "00000000-0000-0000-0000-000000000003",
                    "version": 7,
                }],
            },
        })
    );
}

#[test]
fn purge_stays_internal() {
    let event = DatabaseTopicEvent::Purged(DatabasePurgedMetadata {
        database_id: database_id(),
    });
    assert!(matches!(event.exposure().unwrap(), Exposure::Internal(_)));
}

#[test]
fn public_payload_has_a_schema() {
    use utoipa::ToSchema as _;
    assert_eq!(DatabasePublicEvent::name(), "DatabasePublicEvent");
}
