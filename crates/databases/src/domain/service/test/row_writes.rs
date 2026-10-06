//! Row ops are scoped to the receipt's database and the viewer's grants.

use super::*;

#[tokio::test]
async fn a_write_to_a_row_of_another_table_is_refused() {
    let seeded = seeded().await;
    let (world, svc, database_id, table_id, row_id) = (
        seeded.world,
        seeded.service,
        seeded.database_id,
        seeded.table_id,
        seeded.row_id,
    );
    let (sessions, title) = (TableId::new(), ColumnId::new());
    svc.apply_ops(
        edit(database_id),
        viewer(OWNER),
        OpBatch::from(vec![
            DatabaseOp::Table {
                table: sessions,
                change: TableChange::Create {
                    name: "Sessions".into(),
                },
            },
            DatabaseOp::Column {
                table: sessions,
                column: title,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Title".into(),
                        kind: ColumnKind::Text,
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
    let cells_before = world.lock().unwrap().cells.clone();
    let sessions_version = table_version(&world, sessions);

    let error = svc
        .apply_ops(
            receipt::<EditAccessLevel>(database_id, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: sessions,
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![row_id],
                        cells: vec![CellWrite {
                            column: title,
                            value: CellValue::Text("Hijacked".into()),
                        }],
                    },
                },
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: Some(0),
            column: None,
            taken: None,
            reason: format!("no row {row_id} in this table"),
        }
    );
    let error = svc
        .apply_ops(
            receipt::<EditAccessLevel>(database_id, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: sessions,
                change: RowsChange::Delete { rows: vec![row_id] },
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: Some(0),
            column: None,
            taken: None,
            reason: format!("no row {row_id} in this table"),
        }
    );

    assert_eq!(world.lock().unwrap().cells, cells_before);
    assert_eq!(row_ids(&world, table_id), vec![row_id]);
    assert_eq!(table_version(&world, sessions), sessions_version);
}

#[tokio::test]
async fn a_view_grant_reads_but_cannot_be_receipted_for_ops() {
    let seeded = seeded().await;

    let edit = EntityAccessReceipt::<EditAccessLevel>::try_new_authenticated_user(
        user(VIEWER),
        Entity {
            entity_id: seeded.database_id.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    );
    assert!(edit.is_err(), "ops need an edit receipt");

    let detail = seeded
        .service
        .get_database(receipt::<ViewAccessLevel>(
            seeded.database_id,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    assert_eq!(detail.grant, AccessLevel::View);
    assert!(
        detail.tables[0]
            .columns
            .iter()
            .all(|column| !column.writable)
    );
}

#[tokio::test]
async fn grants_scope_writes_per_database() {
    let seeded = seeded().await;
    let (world, svc) = (seeded.world, seeded.service);
    let venue = svc
        .create_database(CreateDatabase {
            name: "Venue".into(),
            owner_id: user(VIEWER),
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    let (rooms, room_name) = {
        let mut world_state = world.lock().unwrap();
        let table = world_state
            .tables
            .iter_mut()
            .find(|table| table.database_id == venue.id)
            .unwrap();
        table.name = "Rooms".into();
        let rooms = table.id;
        // The database starts with its title column, Name.
        let room_name = world_state
            .columns
            .iter()
            .find(|column| column.table_id == rooms)
            .unwrap()
            .id;
        (rooms, room_name)
    };

    // VIEWER writes their own database...
    let written = svc
        .apply_ops(
            receipt::<EditAccessLevel>(venue.id, VIEWER, AccessLevel::Owner),
            viewer(VIEWER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: rooms,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: room_name,
                        value: CellValue::Text("Main Hall".into()),
                    }]],
                },
            }]),
        )
        .await
        .unwrap();
    assert!(matches!(
        written.as_slice(),
        [OpResult::Rows {
            table_version: TableVersion(1),
            change: RowsResult::Inserted { rows },
            ..
        }] if rows.len() == 1
    ));

    // ...but their receipt on it reaches no table of OWNER's.
    let error = svc
        .apply_ops(
            receipt::<EditAccessLevel>(venue.id, VIEWER, AccessLevel::Owner),
            viewer(VIEWER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert { rows: vec![vec![]] },
            }]),
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal.reason,
        format!("table {} is not in this database", seeded.table_id)
    );

    // OWNER has no grant on Venue: it is not theirs to list.
    let listed = svc.list_databases(viewer(OWNER)).await.unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|listed| listed.database.id)
            .collect::<Vec<_>>(),
        vec![seeded.database_id]
    );
    let w = world.lock().unwrap();
    assert_eq!(w.rows[&rooms].len(), 1);
    assert_eq!(w.rows[&seeded.table_id].len(), 1);
}
