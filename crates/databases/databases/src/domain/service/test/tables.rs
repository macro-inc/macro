use super::*;

#[tokio::test]
async fn create_table_announces_only_the_committed_table() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);
    {
        let mut world = world.lock().unwrap();
        world.published.clear();
        world.broker_events.clear();
    }
    let tickets = TableId::new();
    let results = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: tickets,
                change: TableChange::Create {
                    name: "Tickets".into(),
                },
            }]),
        )
        .await
        .unwrap();
    assert_eq!(
        results,
        vec![OpResult::Table {
            table: tickets,
            table_version: Some(TableVersion(1)),
            change: TableResult::Created,
        }]
    );
    {
        let w = world.lock().unwrap();
        let table = w.tables.iter().find(|table| table.id == tickets).unwrap();
        assert_eq!(table.name, "Tickets");
        assert_eq!(w.published, [(tickets, TableVersion(1))]);
        assert_eq!(w.broker_events.len(), 1);
        let event = &w.broker_events[0];
        assert_eq!(event["event_type"], "database.tables_changed");
        assert_eq!(event["metadata"]["database_id"], db.to_string());
        assert_eq!(event["metadata"]["attribution"]["actor"], OWNER);
        assert_eq!(
            event["metadata"]["tables"],
            serde_json::json!([{ "table_id": tickets, "version": 1 }])
        );
    }

    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: TableId::new(),
                change: TableChange::Create {
                    name: "tickets".into(),
                },
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "a table named `tickets` already exists in this database"
    );
    let w = world.lock().unwrap();
    assert_eq!(w.published.len(), 1);
    assert_eq!(w.broker_events.len(), 1);
    assert_eq!(w.tables.len(), 2);
}

/// Names compare as the SQL engine matches them, case-folded beyond ASCII.
#[tokio::test]
async fn a_table_name_differing_only_in_non_ascii_case_is_taken() {
    let seeded = seeded().await;
    let (svc, db) = (seeded.service, seeded.database_id);
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Table {
            table: TableId::new(),
            change: TableChange::Create {
                name: "Ärger".into(),
            },
        }]),
    )
    .await
    .unwrap();

    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: TableId::new(),
                change: TableChange::Create {
                    name: "ärger".into(),
                },
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        "a table named `ärger` already exists in this database"
    );
}

#[tokio::test]
async fn parent_disappearing_at_table_write_stays_not_found_and_publishes_nothing() {
    let seeded = seeded().await;
    let (world, svc, db, table_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    {
        let mut world = world.lock().unwrap();
        world.published.clear();
        world.broker_events.clear();
        world.table_write_not_found = true;
    }
    let create = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: TableId::new(),
                change: TableChange::Create {
                    name: "Unavailable".into(),
                },
            }]),
        )
        .await;
    let rename = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: table_id,
                change: TableChange::Rename {
                    name: "Unavailable".into(),
                    previous_name: Some("Guests".into()),
                },
            }]),
        )
        .await;
    assert!(matches!(create, Err(DatabaseError::NotFound)), "{create:?}");
    assert!(matches!(rename, Err(DatabaseError::NotFound)), "{rename:?}");
    let world = world.lock().unwrap();
    assert!(world.published.is_empty());
    assert!(world.broker_events.is_empty());
    assert!(!world.tables.iter().any(|table| table.name == "Unavailable"));
}

#[tokio::test]
async fn a_new_table_is_empty_and_named_by_its_quoted_sql_name() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);
    let sales = TableId::new();
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Table {
            table: sales,
            change: TableChange::Create {
                name: "  Ticket sales ".into(),
            },
        }]),
    )
    .await
    .unwrap();

    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(detail.tables[1].table.id, sales);
    assert_eq!(detail.tables[1].table.name, "Ticket sales");
    assert_eq!(
        detail
            .tables
            .iter()
            .map(|table| table.sql_name.as_str())
            .collect::<Vec<_>>(),
        vec!["\"Offsite\".\"Guests\"", "\"Offsite\".\"Ticket sales\""]
    );
    assert!(detail.tables[1].columns.is_empty());

    assert!(
        world
            .lock()
            .unwrap()
            .rows
            .get(&sales)
            .is_none_or(Vec::is_empty)
    );
}

#[tokio::test]
async fn reordering_three_tables_answers_and_lists_them_in_the_new_order() {
    let seeded = seeded().await;
    let (world, svc, db, guests) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let (budget, venues) = (TableId::new(), TableId::new());
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![
            DatabaseOp::Table {
                table: budget,
                change: TableChange::Create {
                    name: "Budget".into(),
                },
            },
            DatabaseOp::Table {
                table: venues,
                change: TableChange::Create {
                    name: "Venues".into(),
                },
            },
        ]),
    )
    .await
    .unwrap();
    {
        let mut world = world.lock().unwrap();
        world.published.clear();
        world.broker_events.clear();
    }

    let results = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::ReorderTables {
                order: vec![venues, guests, budget],
            }]),
        )
        .await
        .unwrap();
    let [OpResult::ReorderTables { tables }] = results.as_slice() else {
        panic!("expected one reorder, got {results:?}");
    };
    assert_eq!(
        tables.iter().map(|table| table.table).collect::<Vec<_>>(),
        vec![venues, guests, budget]
    );

    let detail = svc
        .get_database(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(
        detail
            .tables
            .iter()
            .map(|t| t.table.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Venues", "Guests", "Budget"]
    );

    let world = world.lock().unwrap();
    let mut published = world.published.clone();
    published.sort();
    let mut expected: Vec<(TableId, TableVersion)> = tables
        .iter()
        .map(|table| (table.table, table.version))
        .collect();
    expected.sort();
    assert_eq!(published, expected);
    assert_eq!(world.broker_events.len(), 1);
    assert_eq!(
        world.broker_events[0]["event_type"],
        "database.tables_changed"
    );
    assert_eq!(
        world.broker_events[0]["metadata"]["tables"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[tokio::test]
async fn an_order_missing_a_table_is_rejected_without_publishing() {
    let seeded = seeded().await;
    let (world, svc, db, guests) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![DatabaseOp::Table {
            table: TableId::new(),
            change: TableChange::Create {
                name: "Budget".into(),
            },
        }]),
    )
    .await
    .unwrap();
    {
        let mut world = world.lock().unwrap();
        world.published.clear();
        world.broker_events.clear();
    }

    for order in [vec![guests], vec![guests, guests]] {
        let error = svc
            .apply_ops(
                edit(db),
                viewer(OWNER),
                OpBatch::from(vec![DatabaseOp::ReorderTables { order }]),
            )
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = error else {
            panic!("expected a refused op, got {error:?}");
        };
        assert_eq!(
            refusal.reason,
            "The table order must include every table of this database exactly once."
        );
    }

    let world = world.lock().unwrap();
    assert!(world.published.is_empty());
    assert!(world.broker_events.is_empty());
}

#[tokio::test]
async fn an_order_containing_another_databases_table_is_rejected() {
    let seeded = seeded().await;
    let (world, svc, db, guests) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let other = svc
        .create_database(CreateDatabase {
            name: "Hiring".into(),
            owner_id: user(OWNER),
            acting_bot: None,
        })
        .await
        .unwrap();
    let candidates = world
        .lock()
        .unwrap()
        .tables
        .iter()
        .find(|table| table.database_id == other.id)
        .unwrap()
        .id;
    {
        let mut world = world.lock().unwrap();
        world.published.clear();
        world.broker_events.clear();
    }

    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::ReorderTables {
                order: vec![candidates, guests],
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        format!("table {candidates} is not in this database")
    );

    let world = world.lock().unwrap();
    assert!(world.published.is_empty());
    assert!(world.broker_events.is_empty());
}
