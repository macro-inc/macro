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
    // `(database, version, searchable)`; `read_at` is the server's clock.
    let state = async |table_id| {
        read_table_state(&pool, table_id)
            .await
            .unwrap()
            .map(|state| (state.database_id, state.version, state.searchable))
    };
    assert_eq!(state(TABLE).await, Some((DATABASE, 7, true)));
    assert_eq!(
        state(TRASHED_TABLE).await,
        Some((TRASHED_DATABASE, 1, false))
    );
    assert_eq!(
        state(STORAGE_ONLY_TABLE).await,
        Some((STORAGE_ONLY_DATABASE, 1, false))
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
async fn pages_a_tables_rows_in_position_order(pool: PgPool) {
    let first = read_table_rows(&pool, TABLE, None, 1).await.unwrap();
    assert_eq!(
        first,
        vec![RowPlace {
            position: "a".to_owned(),
            id: LAUNCH_ROW,
        }]
    );
    assert_eq!(
        read_table_rows(&pool, TABLE, first.last(), 10)
            .await
            .unwrap(),
        vec![RowPlace {
            position: "b".to_owned(),
            id: EMPTY_ROW,
        }]
    );
    assert_eq!(
        read_searchable_database_ids(&pool, Some(DATABASE), 10)
            .await
            .unwrap(),
        Vec::<Uuid>::new()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_watermark_never_moves_back(pool: PgPool) {
    raise_watermark(&pool, TABLE, DATABASE, 7, "fingerprint")
        .await
        .unwrap();
    raise_watermark(&pool, TABLE, DATABASE, 5, "fingerprint")
        .await
        .unwrap();
    assert_eq!(read_watermark(&pool, TABLE).await.unwrap(), Some(7));

    // The table does not exist in this database, so its mark is a gone table's.
    assert_eq!(
        read_watermarks_of_gone_tables(&pool, 10).await.unwrap(),
        vec![TABLE]
    );

    delete_database_watermarks(&pool, DATABASE).await.unwrap();
    assert_eq!(read_watermark(&pool, TABLE).await.unwrap(), None);
}

/// Every column change kind the journal records, and whether it changes
/// rows' text without naming the rows. A new kind fails to compile here until
/// someone decides; a wrong answer would leave stale text in the index.
#[test]
fn every_column_change_kind_is_classified() {
    use databases::domain::journal::ColumnChangeKind;
    use strum::IntoEnumIterator as _;

    fn reshapes_text(kind: ColumnChangeKind) -> bool {
        match kind {
            ColumnChangeKind::Create
            | ColumnChangeKind::ChangeType
            | ColumnChangeKind::Delete
            | ColumnChangeKind::UpdateOption
            | ColumnChangeKind::DeleteOption
            | ColumnChangeKind::Reorder
            | ColumnChangeKind::InferType
            | ColumnChangeKind::Related => true,
            ColumnChangeKind::Rename
            | ColumnChangeKind::SetFormula
            | ColumnChangeKind::AddOptions => false,
        }
    }

    for kind in ColumnChangeKind::iter() {
        let name: &'static str = kind.into();
        assert_eq!(
            TEXT_RESHAPING_COLUMN_CHANGES.contains(&name),
            reshapes_text(kind),
            "{name}"
        );
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows"))
)]
async fn a_searchable_table_behind_its_watermark_is_lagging(pool: PgPool) {
    // No watermark yet; trashed and storage-only tables never lag.
    assert_eq!(
        read_lagging_tables(&pool, None, 10).await.unwrap(),
        vec![TABLE]
    );

    raise_watermark(&pool, TABLE, DATABASE, 7, "fingerprint")
        .await
        .unwrap();
    assert_eq!(
        read_lagging_tables(&pool, None, 10).await.unwrap(),
        Vec::<Uuid>::new()
    );

    sqlx::query("UPDATE database_tables SET version = 8 WHERE id = $1")
        .bind(TABLE)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        read_lagging_tables(&pool, Some(Uuid::nil()), 10)
            .await
            .unwrap(),
        vec![TABLE]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("rows"))
)]
async fn a_change_outside_the_journal_reshapes_the_table(pool: PgPool) {
    let raise = async || {
        let fingerprint = read_column_fingerprint(&pool, TABLE).await.unwrap();
        raise_watermark(&pool, TABLE, DATABASE, 7, &fingerprint)
            .await
            .unwrap();
    };
    let reshaped = async || read_reshaped_tables(&pool, 10).await.unwrap();

    // A watermark raised from the current columns is not reshaped: the two
    // queries spell the digest the same way.
    raise().await;
    assert_eq!(reshaped().await, Vec::<Uuid>::new());

    // The owner's tag set relabelled through the properties service.
    sqlx::query(
        "UPDATE property_options SET string_value = 'critical', updated_at = now() + INTERVAL '1 second' WHERE id = '40000000-0000-7000-8000-000000000003'",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(reshaped().await, vec![TABLE]);
    raise().await;
    assert_eq!(reshaped().await, Vec::<Uuid>::new());

    // An option deleted from the tag set leaves no option row.
    sqlx::query("DELETE FROM property_options WHERE id = '40000000-0000-7000-8000-000000000003'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(reshaped().await, vec![TABLE]);
    raise().await;

    // The tag set itself deleted: its column goes with it, unjournaled.
    sqlx::query(
        "DELETE FROM property_definitions WHERE id = '30000000-0000-7000-8000-000000000006'",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(reshaped().await, vec![TABLE]);
}
