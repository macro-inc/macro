//! A table's changes since a version, over Postgres, on the guest list.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::apply_ops::service;
use super::journal::{
    WOLF, insert_guests, julia_deletes_omar, julia_says_maybe, view_as, wedding,
    wolf_deletes_plus_ones,
};
use crate::domain::journal::{
    ColumnChangeKind, RowChangeKind, TableChanges, TouchedColumn, TouchedRow,
};
use crate::domain::models::TableVersion;
use crate::domain::ports::DatabasesService;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reader_learns_which_rows_and_columns_changed_since_its_version(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, omar) = insert_guests(&pool, &wedding).await;
    julia_says_maybe(&pool, &wedding, maria).await;
    julia_deletes_omar(&pool, &wedding, omar).await;
    wolf_deletes_plus_ones(&pool, &wedding).await;
    let service = service(&pool);

    let since_setup = service
        .table_changes(
            view_as(WOLF, wedding.database_id),
            wedding.table_id,
            TableVersion(1),
        )
        .await
        .unwrap();
    let since_maybe = service
        .table_changes(
            view_as(WOLF, wedding.database_id),
            wedding.table_id,
            TableVersion(3),
        )
        .await
        .unwrap();
    let current = service
        .table_changes(
            view_as(WOLF, wedding.database_id),
            wedding.table_id,
            TableVersion(5),
        )
        .await
        .unwrap();

    assert_eq!(
        since_setup,
        TableChanges {
            version: TableVersion(5),
            complete: true,
            truncated: false,
            rows: vec![TouchedRow {
                row: maria,
                kind: RowChangeKind::Insert,
            }],
            columns: vec![TouchedColumn {
                column: wedding.plus_ones,
                kind: ColumnChangeKind::Delete,
            }],
        }
    );
    assert_eq!(
        since_maybe,
        TableChanges {
            version: TableVersion(5),
            complete: true,
            truncated: false,
            rows: vec![
                TouchedRow {
                    row: omar,
                    kind: RowChangeKind::Delete,
                },
                TouchedRow {
                    row: maria,
                    kind: RowChangeKind::Update,
                },
            ],
            columns: vec![TouchedColumn {
                column: wedding.plus_ones,
                kind: ColumnChangeKind::Delete,
            }],
        }
    );
    assert_eq!(
        current,
        TableChanges {
            version: TableVersion(5),
            complete: true,
            truncated: false,
            rows: Vec::new(),
            columns: Vec::new(),
        }
    );
}
