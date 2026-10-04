use super::*;

#[tokio::test]
async fn deleting_a_table_removes_its_rows_cells_and_columns() {
    let seeded = seeded().await;
    let (world, svc, db, guests, sam) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
    );
    let tickets = TableId::new();
    svc.apply_ops(
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
    let guests_version = {
        let mut w = world.lock().unwrap();
        w.published.clear();
        w.broker_events.clear();
        w.tables.iter().find(|t| t.id == guests).unwrap().version
    };

    let results = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: guests,
                change: TableChange::Delete,
            }]),
        )
        .await
        .unwrap();
    assert_eq!(
        results,
        vec![OpResult::Table {
            table: guests,
            table_version: None,
            change: TableResult::Deleted,
        }]
    );

    {
        let w = world.lock().unwrap();
        assert_eq!(
            w.tables.iter().map(|t| t.id).collect::<Vec<_>>(),
            vec![tickets]
        );
        assert!(!w.columns.iter().any(|c| c.table_id == guests));
        assert!(!w.rows.contains_key(&guests));
        assert!(!w.cells.contains_key(&sam), "the row's cells are cleared");
        assert_eq!(w.published, [(guests, guests_version)]);
        assert_eq!(w.broker_events.len(), 1);
        assert_eq!(w.broker_events[0]["event_type"], "database.tables_changed");
        assert_eq!(
            w.broker_events[0]["metadata"]["tables"],
            serde_json::json!([{ "table_id": guests, "version": guests_version.0 }])
        );
    }

    let last = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: tickets,
                change: TableChange::Delete,
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = last else {
        panic!("expected a refused op, got {last:?}");
    };
    assert_eq!(refusal.reason, SchemaError::LastTable.to_string());
    assert_eq!(world.lock().unwrap().tables.len(), 1);

    let gone = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: guests,
                change: TableChange::Delete,
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = gone else {
        panic!("expected a refused op, got {gone:?}");
    };
    assert_eq!(
        refusal.reason,
        format!("table {guests} is not in this database")
    );
}

#[tokio::test]
async fn a_table_another_table_relates_to_is_not_deleted() {
    let seeded = seeded().await;
    let (world, svc, db, guests) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
    );
    let invites = TableId::new();
    svc.apply_ops(
        edit(db),
        viewer(OWNER),
        OpBatch::from(vec![
            DatabaseOp::Table {
                table: invites,
                change: TableChange::Create {
                    name: "Invites".into(),
                },
            },
            DatabaseOp::Column {
                table: invites,
                column: ColumnId::new(),
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Guest".into(),
                        kind: ColumnKind::Relation {
                            database: db,
                            table: guests,
                        },
                        options: vec![],
                        infer_type: false,
                    },
                    after: None,
                },
            },
        ]),
    )
    .await
    .unwrap();

    let error = svc
        .apply_ops(
            edit(db),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: guests,
                change: TableChange::Delete,
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        SchemaError::TableIsRelated {
            column: "Guest".into(),
            source_table: "Invites".into(),
            table: "Guests".into(),
        }
        .to_string()
    );
    let w = world.lock().unwrap();
    assert!(w.tables.iter().any(|t| t.id == guests));
    assert!(w.cells.contains_key(&seeded.row_id));
}
