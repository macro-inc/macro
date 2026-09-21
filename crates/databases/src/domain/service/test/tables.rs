use super::*;

#[tokio::test]
async fn create_table_announces_only_the_committed_table() {
    let (world, svc, db, _) = seeded().await;
    {
        let mut world = world.lock().unwrap();
        world.published.clear();
        world.broker_events.clear();
    }
    let table = svc
        .create_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            CreateTable {
                database_id: db,
                name: "Tickets".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(world.lock().unwrap().published, [(table.id, table.version)]);
    assert_eq!(broker_event_types(&world), ["database.tables_changed"]);
    let event = world.lock().unwrap().broker_events[0].clone();
    assert_eq!(event["metadata"]["database_id"], db.to_string());
    assert_eq!(event["metadata"]["attribution"]["actor"], OWNER);
    assert_eq!(
        event["metadata"]["tables"][0]["table_id"],
        table.id.to_string()
    );
    assert_eq!(event["metadata"]["tables"][0]["version"], table.version.0);

    let error = svc
        .create_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            CreateTable {
                database_id: db,
                name: "tickets".into(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::InvalidSchemaOperation(_)));
    assert_eq!(world.lock().unwrap().published.len(), 1);
    assert_eq!(world.lock().unwrap().broker_events.len(), 1);
}

#[tokio::test]
async fn parent_disappearing_at_table_write_stays_not_found_and_publishes_nothing() {
    let (world, svc, db, table_id) = seeded().await;
    {
        let mut world = world.lock().unwrap();
        world.published.clear();
        world.broker_events.clear();
        world.table_write_not_found = true;
    }
    let create = svc
        .create_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            CreateTable {
                database_id: db,
                name: "Unavailable".into(),
            },
        )
        .await;
    let rename = svc
        .rename_table(
            receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
            table_id,
            "Unavailable".into(),
            "Guests".into(),
        )
        .await;
    assert!(matches!(create, Err(DatabaseError::NotFound)));
    assert!(matches!(rename, Err(DatabaseError::NotFound)));
    let world = world.lock().unwrap();
    assert!(world.published.is_empty());
    assert!(world.broker_events.is_empty());
    assert!(!world.tables.iter().any(|table| table.name == "Unavailable"));
}
