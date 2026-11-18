//! Storage reads of named rows across several tables: only the rows each read
//! names that belong to its table, with its table's columns, even when two
//! reads name one table.

use models_databases::{CellValue, CellWrite, DatabaseOp, RowsChange};
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use super::apply_ops::{edit, guests, service, viewer};
use super::*;
use crate::domain::models::{CreateDatabase, DatabaseId, TableId};
use crate::domain::ports::{DatabasesRepo, DatabasesService};
use crate::domain::storage::{DatabaseStorageService, StorageRowsRead};

fn row(n: u128) -> RowId {
    RowId::from_uuid(Uuid::from_u128(
        0x0196_0000_0000_7000_8000_0000_0000_0000 + n,
    ))
}

async fn insert_named(
    pool: &PgPool,
    database: DatabaseId,
    table: TableId,
    column: crate::domain::models::ColumnId,
    rows: &[(RowId, &str)],
) {
    service(pool)
        .apply_ops(
            edit(database),
            viewer(),
            vec![DatabaseOp::Rows {
                table,
                change: RowsChange::Insert {
                    rows: rows
                        .iter()
                        .map(|(_, name)| {
                            vec![CellWrite {
                                column,
                                value: CellValue::Text((*name).into()),
                            }]
                        })
                        .collect(),
                    ids: Some(rows.iter().map(|(id, _)| *id).collect()),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn named_rows_are_read_only_from_the_table_each_read_names(pool: PgPool) {
    let guests = guests(&pool).await;
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let elsewhere = service(&pool)
        .create_database(CreateDatabase {
            name: "Elsewhere".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
            first_table: None,
        })
        .await
        .unwrap();
    let elsewhere_table = repo.get_database(elsewhere.id).await.unwrap().unwrap().1[0].id;
    let elsewhere_name = repo.columns_for_tables(&[elsewhere_table]).await.unwrap()[0].id;
    let (sam, alex, kim, robin, missing) = (row(1), row(2), row(3), row(4), row(5));
    insert_named(
        &pool,
        guests.database_id,
        guests.table_id,
        guests.name,
        &[(sam, "Sam"), (alex, "Alex"), (kim, "Kim")],
    )
    .await;
    insert_named(
        &pool,
        elsewhere.id,
        elsewhere_table,
        elsewhere_name,
        &[(robin, "Robin")],
    )
    .await;

    let refs = repo
        .rows_in_tables(&[guests.table_id], &[kim, sam, robin, missing])
        .await
        .unwrap();
    assert_eq!(
        refs.iter()
            .map(|(table, row)| (*table, row.id))
            .collect::<Vec<_>>(),
        vec![(guests.table_id, sam), (guests.table_id, kim)],
        "only the named rows of the named tables, in position order"
    );

    let read = service(&pool)
        .storage_tables_rows(&[
            StorageRowsRead {
                database: guests.database_id,
                table: guests.table_id,
                rows: vec![kim, robin, sam, missing],
            },
            StorageRowsRead {
                database: guests.database_id,
                table: elsewhere_table,
                rows: vec![robin],
            },
            StorageRowsRead {
                database: elsewhere.id,
                table: elsewhere_table,
                rows: vec![robin, alex],
            },
            StorageRowsRead {
                database: guests.database_id,
                table: guests.table_id,
                rows: vec![alex],
            },
        ])
        .await
        .unwrap();

    assert_eq!(read.len(), 3, "a table outside its resource is left out");
    assert_eq!(read[0].table, guests.table_id);
    assert_eq!(
        read[0]
            .columns
            .iter()
            .map(|column| (column.column.id, column.sql_name.as_str()))
            .collect::<Vec<_>>(),
        vec![(guests.name, "\"Name\""), (guests.status, "\"Status\"")]
    );
    assert_eq!(
        read[0]
            .rows
            .iter()
            .map(|row| (row.row_id, row.cells.get(&guests.name).cloned()))
            .collect::<Vec<_>>(),
        vec![
            (sam, Some(PropertyValue::Str("Sam".into()))),
            (kim, Some(PropertyValue::Str("Kim".into()))),
        ]
    );
    assert_eq!(read[1].table, elsewhere_table);
    assert_eq!(
        read[1]
            .rows
            .iter()
            .map(|row| (row.row_id, row.cells.get(&elsewhere_name).cloned()))
            .collect::<Vec<_>>(),
        vec![(robin, Some(PropertyValue::Str("Robin".into())))]
    );
    assert_eq!(read[2].table, guests.table_id);
    assert_eq!(
        read[2]
            .rows
            .iter()
            .map(|row| row.row_id)
            .collect::<Vec<_>>(),
        vec![alex],
        "a second read of the same table gets only its own rows"
    );
}
