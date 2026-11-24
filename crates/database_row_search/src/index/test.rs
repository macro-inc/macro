use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::{Uuid, uuid};

use super::*;

const DATABASE: Uuid = uuid!("10000000-0000-7000-8000-000000000001");
const TRASHED_DATABASE: Uuid = uuid!("10000000-0000-7000-8000-000000000002");
const STORAGE_ONLY_DATABASE: Uuid = uuid!("10000000-0000-7000-8000-000000000003");
const TABLE: Uuid = uuid!("20000000-0000-7000-8000-000000000001");
const TRASHED_TABLE: Uuid = uuid!("20000000-0000-7000-8000-000000000002");
const STORAGE_ONLY_TABLE: Uuid = uuid!("20000000-0000-7000-8000-000000000003");
const LAUNCH_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000001");
const EMPTY_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000002");
const TRASHED_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000003");
const STORAGE_ONLY_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000004");

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows"))
)]
async fn a_table_is_searchable_only_in_a_live_database_entity(pool: PgPool) {
    assert_eq!(
        read_table_state(&pool, TABLE).await.unwrap(),
        Some(TableState {
            database_id: DATABASE,
            version: 7,
            searchable: true,
        })
    );
    assert_eq!(
        read_table_state(&pool, TRASHED_TABLE).await.unwrap(),
        Some(TableState {
            database_id: TRASHED_DATABASE,
            version: 1,
            searchable: false,
        })
    );
    assert_eq!(
        read_table_state(&pool, STORAGE_ONLY_TABLE).await.unwrap(),
        Some(TableState {
            database_id: STORAGE_ONLY_DATABASE,
            version: 1,
            searchable: false,
        })
    );
    assert_eq!(read_table_state(&pool, Uuid::nil()).await.unwrap(), None);

    assert_eq!(
        read_database_tables(&pool, TRASHED_DATABASE).await.unwrap(),
        Some(DatabaseTables {
            searchable: false,
            table_ids: vec![TRASHED_TABLE],
        })
    );
    assert_eq!(
        read_database_tables(&pool, Uuid::nil()).await.unwrap(),
        None
    );
    assert_eq!(
        read_searchable_database_ids(&pool, None, 10).await.unwrap(),
        vec![DATABASE]
    );
    assert_eq!(
        read_searchable_row_ids(&pool, &[LAUNCH_ROW, TRASHED_ROW, STORAGE_ONLY_ROW])
            .await
            .unwrap(),
        vec![LAUNCH_ROW]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows", "journal"))
)]
async fn reads_the_journal_of_one_table_in_a_version_range(pool: PgPool) {
    assert_eq!(
        read_table_changes(&pool, TABLE, 4, 6).await.unwrap(),
        TableChanges {
            versions: vec![5, 6],
            row_ids: vec![LAUNCH_ROW, EMPTY_ROW],
            // A column rename changes no row's text.
            reshapes_text: false,
        }
    );
    assert_eq!(
        read_table_changes(&pool, TABLE, 6, 7).await.unwrap(),
        TableChanges {
            versions: vec![7],
            row_ids: Vec::new(),
            reshapes_text: true,
        }
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows"))
)]
async fn pages_a_tables_rows_in_id_order(pool: PgPool) {
    assert_eq!(
        read_table_row_ids(&pool, TABLE, None, 1).await.unwrap(),
        vec![LAUNCH_ROW]
    );
    assert_eq!(
        read_table_row_ids(&pool, TABLE, Some(LAUNCH_ROW), 10)
            .await
            .unwrap(),
        vec![EMPTY_ROW]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_watermark_never_moves_back(pool: PgPool) {
    raise_watermark(&pool, TABLE, DATABASE, 7).await.unwrap();
    raise_watermark(&pool, TABLE, DATABASE, 5).await.unwrap();
    assert_eq!(read_watermark(&pool, TABLE).await.unwrap(), Some(7));

    // The table does not exist in this database, so its mark is a gone table's.
    assert_eq!(
        read_watermarks_of_gone_tables(&pool, 10).await.unwrap(),
        vec![TABLE]
    );

    delete_database_watermarks(&pool, DATABASE).await.unwrap();
    assert_eq!(read_watermark(&pool, TABLE).await.unwrap(), None);
}
