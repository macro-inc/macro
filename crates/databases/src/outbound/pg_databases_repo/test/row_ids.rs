//! Row ids a client mints: an insert's rows take them, and an id that
//! already names a row, or is minted twice, refuses the batch whole.

use models_databases::{
    CellValue, CellWrite, DatabaseOp, OpResult, RowsChange, RowsResult, TableVersion, TakenId,
};
use uuid::Uuid;

use super::apply_ops::{edit, guests, service, version, viewer};
use super::*;
use crate::domain::models::{CreateDatabase, DatabaseError, OpRefusal};
use crate::domain::ports::{DatabasesRepo, DatabasesService};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inserted_rows_take_the_ids_the_client_minted(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;
    let sam = RowId::from_uuid(Uuid::from_u128(0x0196_0000_0000_7000_8000_0000_0000_5a11));
    let alex = RowId::from_uuid(Uuid::from_u128(0x0196_0000_0000_7000_8000_0000_0000_a1e7));

    let results = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert {
                        rows: vec![
                            vec![CellWrite {
                                column: guests.name,
                                value: CellValue::Text("Sam".into()),
                            }],
                            vec![CellWrite {
                                column: guests.name,
                                value: CellValue::Text("Alex".into()),
                            }],
                        ],
                        ids: Some(vec![sam, alex]),
                    },
                },
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Delete { rows: vec![alex] },
                },
            ]
            .into(),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![
            OpResult::Rows {
                table: guests.table_id,
                table_version: TableVersion(before.0 + 1),
                change: RowsResult::Inserted {
                    rows: vec![sam, alex],
                },
            },
            OpResult::Rows {
                table: guests.table_id,
                table_version: TableVersion(before.0 + 1),
                change: RowsResult::Deleted { affected: 1 },
            },
        ]
    );
    let rows = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(guests.table_id)
        .await
        .unwrap();
    assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), vec![sam]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_retried_insert_whose_first_attempt_committed_is_refused_as_taken(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let sam = RowId::from_uuid(Uuid::from_u128(0x0196_0000_0000_7000_8000_0000_0000_5a11));
    let insert = vec![DatabaseOp::Rows {
        table: guests.table_id,
        change: RowsChange::Insert {
            rows: vec![vec![CellWrite {
                column: guests.name,
                value: CellValue::Text("Sam".into()),
            }]],
            ids: Some(vec![sam]),
        },
    }];
    service
        .apply_ops(edit(guests.database_id), viewer(), insert.clone().into())
        .await
        .unwrap();
    let committed = version(&pool, guests.table_id).await;

    let error = service
        .apply_ops(edit(guests.database_id), viewer(), insert.into())
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: None,
            column: None,
            taken: Some(TakenId::Row(sam)),
            reason: format!(
                "{sam} already names a row; mint a new id for each row a request creates"
            ),
        }
    );
    let rows = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(guests.table_id)
        .await
        .unwrap();
    assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), vec![sam]);
    assert_eq!(version(&pool, guests.table_id).await, committed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_row_id_another_database_already_has_is_refused_as_taken(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let elsewhere = service
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
            first_table: None,
        })
        .await
        .unwrap();
    let elsewhere_table = repo.get_database(elsewhere.id).await.unwrap().unwrap().1[0].id;
    let taken = RowId::from_uuid(Uuid::from_u128(0x0196_0000_0000_7000_8000_0000_0000_0001));
    service
        .apply_ops(
            edit(elsewhere.id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: elsewhere_table,
                change: RowsChange::Insert {
                    rows: vec![vec![]],
                    ids: Some(vec![taken]),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let before = version(&pool, guests.table_id).await;
    let fresh = RowId::from_uuid(Uuid::from_u128(0x0196_0000_0000_7000_8000_0000_0000_0002));

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("Sam".into()),
                        }],
                        vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("Alex".into()),
                        }],
                    ],
                    ids: Some(vec![fresh, taken]),
                },
            }]
            .into(),
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
            row: None,
            column: None,
            taken: Some(TakenId::Row(taken)),
            reason: format!(
                "{taken} already names a row; mint a new id for each row a request creates"
            ),
        }
    );
    assert_eq!(repo.row_refs(guests.table_id).await.unwrap(), vec![]);
    assert_eq!(
        repo.row_refs(elsewhere_table)
            .await
            .unwrap()
            .iter()
            .map(|row| row.id)
            .collect::<Vec<_>>(),
        vec![taken]
    );
    assert_eq!(version(&pool, guests.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_row_id_minted_twice_in_one_batch_is_refused_as_taken(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;
    let sam = RowId::from_uuid(Uuid::from_u128(0x0196_0000_0000_7000_8000_0000_0000_5a11));

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert {
                        rows: vec![vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("Sam".into()),
                        }]],
                        ids: Some(vec![sam]),
                    },
                },
                DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert {
                        rows: vec![vec![CellWrite {
                            column: guests.name,
                            value: CellValue::Text("Sam again".into()),
                        }]],
                        ids: Some(vec![sam]),
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap_err();

    let DatabaseError::InvalidOp(refusal) = error else {
        panic!("expected a refused op, got {error:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 1,
            row: None,
            column: None,
            taken: Some(TakenId::Row(sam)),
            reason: format!(
                "{sam} already names a row; mint a new id for each row a request creates"
            ),
        }
    );
    let rows = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(guests.table_id)
        .await
        .unwrap();
    assert_eq!(rows, vec![]);
    assert_eq!(version(&pool, guests.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_insert_naming_fewer_ids_than_rows_is_refused(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;
    let sam = RowId::from_uuid(Uuid::from_u128(0x0196_0000_0000_7000_8000_0000_0000_5a11));

    let error = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Rows {
                table: guests.table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![], vec![]],
                    ids: Some(vec![sam]),
                },
            }]
            .into(),
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
            row: None,
            column: None,
            taken: None,
            reason: "an insert gives 1 ids for 2 rows; give one id per row, or none".into(),
        }
    );
    let rows = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(guests.table_id)
        .await
        .unwrap();
    assert_eq!(rows, vec![]);
    assert_eq!(version(&pool, guests.table_id).await, before);
}
