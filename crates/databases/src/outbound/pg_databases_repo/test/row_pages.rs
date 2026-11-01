//! A viewer's query pages of a table's rows, over Postgres, on the guest
//! list: each page is the table at the version it reports, and only a live
//! database's own tables read.

use std::collections::HashMap;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::service::property_value::PropertyValue;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;

use super::apply_ops::{service, version};
use super::journal::{WOLF, insert_guests, user, view_as, wedding};
use crate::domain::models::{CreateDatabase, DatabaseError};
use crate::domain::ports::{DatabaseRowPages, DatabasesRepo, DatabasesService};
use crate::domain::storage::StorageRowsQuery;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_page_holds_the_rows_of_the_version_it_reports(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, omar) = insert_guests(&pool, &wedding).await;

    let page = service(&pool)
        .row_page(
            view_as(WOLF, wedding.database_id),
            wedding.table_id,
            StorageRowsQuery::default(),
        )
        .await
        .unwrap();

    assert_eq!(page.version, version(&pool, wedding.table_id).await);
    assert_eq!(page.next, None);
    assert_eq!(
        page.rows
            .iter()
            .map(|row| (row.row_id, row.cells.get(&wedding.name).cloned()))
            .collect::<HashMap<_, _>>(),
        HashMap::from([
            (maria, Some(PropertyValue::Str("Maria".into()))),
            (omar, Some(PropertyValue::Str("Omar".into()))),
        ])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_databases_table_or_a_trashed_database_reads_as_missing(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let honeymoon = service
        .create_database(CreateDatabase {
            name: "Honeymoon".into(),
            owner_id: user(WOLF),
            acting_bot: None,
        })
        .await
        .unwrap();
    let honeymoon_table = repo.get_database(honeymoon.id).await.unwrap().unwrap().1[0].id;

    let foreign = service
        .row_page(
            view_as(WOLF, wedding.database_id),
            honeymoon_table,
            StorageRowsQuery::default(),
        )
        .await;
    assert!(
        matches!(foreign, Err(DatabaseError::NotFound)),
        "{foreign:?}"
    );

    assert!(
        repo.trash_database(wedding.database_id, chrono::Utc::now())
            .await
            .unwrap()
    );
    let trashed = service
        .row_page(
            view_as(WOLF, wedding.database_id),
            wedding.table_id,
            StorageRowsQuery::default(),
        )
        .await;
    assert!(
        matches!(trashed, Err(DatabaseError::NotFound)),
        "{trashed:?}"
    );
}
