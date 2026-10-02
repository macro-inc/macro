//! Writes announce themselves as `macro.databases` events, attributed to
//! who acted.

use super::*;

#[tokio::test]
async fn lifecycle_and_writes_publish_domain_events() {
    let seeded = seeded().await;
    let (world, svc, db, row_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.row_id,
    );

    // Seeding created the database and then shaped its table.
    {
        let w = world.lock().unwrap();
        assert_eq!(w.broker_events[0]["event_type"], "database.created");
        assert!(
            w.broker_events[1..]
                .iter()
                .all(|event| event["event_type"] == "database.tables_changed"),
            "{:?}",
            w.broker_events
        );
    }
    world.lock().unwrap().broker_events.clear();

    svc.rename_database(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
        "Winter Offsite".into(),
    )
    .await
    .unwrap();
    svc.apply_ops(
        receipt::<EditAccessLevel>(db, OWNER, AccessLevel::Owner),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Rows {
            table: seeded.table_id,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: vec![row_id],
                    cells: vec![CellWrite {
                        column: seeded.status_column.id,
                        value: CellValue::Options(vec![OptionRef::Label("Declined".into())]),
                    }],
                },
            },
        }]),
    )
    .await
    .unwrap();
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.delete_database_permanently(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();

    let events = world.lock().unwrap().broker_events.clone();
    assert_eq!(
        events
            .iter()
            .map(|event| event["event_type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "database.renamed",
            "database.tables_changed",
            "database.trashed",
            "database.restored",
            "database.purged",
        ]
    );
    let renamed = &events[0]["metadata"];
    assert_eq!(renamed["database_id"], db.to_string());
    assert_eq!(renamed["name"], "Winter Offsite");
    assert_eq!(renamed["attribution"]["actor"], OWNER);
    let changed = &events[1]["metadata"];
    assert_eq!(changed["database_id"], db.to_string());
    assert_eq!(changed["attribution"]["actor"], OWNER);
    assert_eq!(
        changed["tables"],
        serde_json::json!([{ "table_id": seeded.table_id, "version": 3 }])
    );
    assert_eq!(events[4]["metadata"]["database_id"], db.to_string());
}

#[tokio::test]
async fn an_agent_is_attributed_as_acting_for_the_user() {
    let seeded = seeded().await;
    let (world, svc, db, row_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.row_id,
    );
    world.lock().unwrap().broker_events.clear();
    let agent = bot_id::MACRO_AI_BOT_ID;

    svc.create_database(CreateDatabase {
        name: "Agent Offsite".into(),
        owner_id: user(OWNER),
        acting_bot: Some(agent),
    })
    .await
    .unwrap();
    svc.rename_database(
        EntityAccessReceipt::try_new_bot(
            agent.into_storage_id(),
            (&entity_access::domain::models::BotAccessScope::user(user(OWNER))).into(),
            Entity {
                entity_id: db.to_string(),
                entity_type: EntityType::Database,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
        .unwrap(),
        "Winter Offsite".into(),
    )
    .await
    .unwrap();
    svc.apply_ops(
        EntityAccessReceipt::try_new_bot(
            agent.into_storage_id(),
            (&entity_access::domain::models::BotAccessScope::user(user(OWNER))).into(),
            Entity {
                entity_id: db.to_string(),
                entity_type: EntityType::Database,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
        .unwrap(),
        Viewer {
            user_id: user(OWNER),
            acting_bot: Some(agent),
        },
        OpBatch::from(vec![DatabaseOp::Rows {
            table: seeded.table_id,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: vec![row_id],
                    cells: vec![CellWrite {
                        column: seeded.status_column.id,
                        value: CellValue::Options(vec![OptionRef::Label("Declined".into())]),
                    }],
                },
            },
        }]),
    )
    .await
    .unwrap();

    let events = world.lock().unwrap().broker_events.clone();
    assert_eq!(
        events
            .iter()
            .map(|event| event["event_type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "database.created",
            "database.renamed",
            "database.tables_changed"
        ]
    );
    for event in &events {
        assert_eq!(
            event["metadata"]["attribution"],
            serde_json::json!({
                "actor": "bot|00000000-0000-0000-0000-00000000a1a1",
                "on_behalf_of": OWNER,
            }),
            "{event}"
        );
    }
}

#[tokio::test]
async fn no_op_lifecycle_calls_publish_nothing() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    world.lock().unwrap().broker_events.clear();

    // Trashing twice and restoring what is not trashed change nothing, so
    // nothing is announced.
    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    svc.restore_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let events = world.lock().unwrap().broker_events.clone();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["event_type"], "database.restored");
}
