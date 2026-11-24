use serde_json::json;
use uuid::uuid;

use super::*;

#[test]
fn a_tables_event_reconciles_the_tables_it_names() {
    let event: DatabaseTopicEvent = serde_json::from_value(json!({
        "event_type": "database.tables_changed",
        "metadata": {
            "database_id": "10000000-0000-7000-8000-000000000001",
            "tables": [
                {"table_id": "20000000-0000-7000-8000-000000000001", "version": 7},
                {"table_id": "20000000-0000-7000-8000-000000000002", "version": 3},
            ],
        },
    }))
    .unwrap();

    assert_eq!(
        describe_database_event(&event),
        DatabaseEventDescription {
            pass: Some((
                uuid!("10000000-0000-7000-8000-000000000001"),
                TableSelection::Tables(vec![
                    uuid!("20000000-0000-7000-8000-000000000001"),
                    uuid!("20000000-0000-7000-8000-000000000002"),
                ]),
                PassKind::CatchUp,
            )),
            event_type: "database.tables_changed",
        }
    );
}

#[test]
fn trash_purge_and_restore_reconcile_the_whole_database() {
    for (event_type, kind) in [
        ("database.trashed", PassKind::CatchUp),
        ("database.purged", PassKind::CatchUp),
        ("database.restored", PassKind::Full),
    ] {
        let event: DatabaseTopicEvent = serde_json::from_value(json!({
            "event_type": event_type,
            "metadata": {"database_id": "10000000-0000-7000-8000-000000000001"},
        }))
        .unwrap();

        assert_eq!(
            describe_database_event(&event).pass,
            Some((
                uuid!("10000000-0000-7000-8000-000000000001"),
                TableSelection::All,
                kind,
            )),
            "{event_type}"
        );
    }
}

#[test]
fn a_rename_changes_nothing_indexed() {
    let event: DatabaseTopicEvent = serde_json::from_value(json!({
        "event_type": "database.renamed",
        "metadata": {"database_id": "10000000-0000-7000-8000-000000000001", "name": "Plans"},
    }))
    .unwrap();

    assert_eq!(describe_database_event(&event).pass, None);
}
