use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::{Uuid, uuid};

use super::*;

const LAUNCH_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000001");
const EMPTY_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000002");
const TRASHED_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000003");
const STORAGE_ONLY_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000004");

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows"))
)]
async fn reads_only_searchable_text(pool: PgPool) {
    let mut rows = read_row_search_text(&pool, &[LAUNCH_ROW, EMPTY_ROW])
        .await
        .unwrap();
    rows.sort_by_key(|row| row.row_id);

    assert_eq!(
        rows,
        vec![
            RowSearchText {
                row_id: LAUNCH_ROW,
                table_id: uuid!("20000000-0000-7000-8000-000000000001"),
                database_id: uuid!("10000000-0000-7000-8000-000000000001"),
                // The mention reads as the person's name, never their id or address.
                title: "Launch with Ada Lovelace".to_owned(),
                // No number, entity reference or date; select labels in the
                // order picked, and an option that no longer exists dropped.
                cell_text: vec![
                    "Launched".to_owned(),
                    "Planning".to_owned(),
                    "https://example.com/launch".to_owned(),
                    "urgent".to_owned(),
                    "3".to_owned(),
                ],
                table_version: 7,
                updated_at: Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap(),
            },
            RowSearchText {
                row_id: EMPTY_ROW,
                table_id: uuid!("20000000-0000-7000-8000-000000000001"),
                database_id: uuid!("10000000-0000-7000-8000-000000000001"),
                title: String::new(),
                // Its Stage cell picks the tag set's "urgent", an option of
                // another definition, which reads as nothing here.
                cell_text: Vec::new(),
                table_version: 7,
                updated_at: Utc.with_ymd_and_hms(2026, 11, 21, 10, 0, 0).unwrap(),
            },
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows"))
)]
async fn leaves_out_trashed_storage_only_and_missing_rows(pool: PgPool) {
    let rows = read_row_search_text(
        &pool,
        &[
            TRASHED_ROW,
            STORAGE_ONLY_ROW,
            uuid!("60000000-0000-7000-8000-000000000099"),
        ],
    )
    .await
    .unwrap();

    assert_eq!(rows, Vec::new());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows"))
)]
async fn a_renamed_option_reads_as_its_new_label(pool: PgPool) {
    sqlx::query("UPDATE property_options SET string_value = 'Shipped' WHERE id = '40000000-0000-7000-8000-000000000002'")
        .execute(&pool)
        .await
        .unwrap();

    let rows = read_row_search_text(&pool, &[LAUNCH_ROW]).await.unwrap();

    assert_eq!(
        rows[0].cell_text,
        vec![
            "Shipped".to_owned(),
            "Planning".to_owned(),
            "https://example.com/launch".to_owned(),
            "urgent".to_owned(),
            "3".to_owned(),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn refuses_more_rows_than_one_read_takes(pool: PgPool) {
    let row_ids = vec![Uuid::nil(); MAX_ROWS_PER_READ + 1];

    let result = read_row_search_text(&pool, &row_ids).await;

    assert!(matches!(
        result,
        Err(ReadError::TooManyRows { requested }) if requested == MAX_ROWS_PER_READ + 1
    ));
}
