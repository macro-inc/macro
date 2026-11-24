//! Writes to the `database_rows` index keep the newest state whatever order
//! they land in, and a row deleted with its database comes back at once when
//! the database does.

use models_opensearch::database_row::DatabaseRowDocument;
use opensearch_client::database_row::{
    DatabaseRowScope, DatabaseRowWrite, DatabaseRowWrites, IndexedDatabaseRow,
};
use uuid::Uuid;

use crate::{refresh, test_clients};

const TABLE: Uuid = Uuid::from_u128(0x5ea4_c400_0000_7000_8000_0000_0000_d100);

/// One database and row per test, since tests run at once.
struct Fixture {
    database: Uuid,
    row: Uuid,
}

const ORDERED: Fixture = Fixture {
    database: Uuid::from_u128(0x5ea4_c400_0000_7000_8000_0000_0000_d001),
    row: Uuid::from_u128(0x5ea4_c400_0000_7000_8000_0000_0000_d201),
};
const RESTORED: Fixture = Fixture {
    database: Uuid::from_u128(0x5ea4_c400_0000_7000_8000_0000_0000_d002),
    row: Uuid::from_u128(0x5ea4_c400_0000_7000_8000_0000_0000_d202),
};

fn row(fixture: &Fixture, title: &str, table_version: i64) -> DatabaseRowWrite {
    DatabaseRowWrite::Upsert(DatabaseRowDocument {
        row_id: fixture.row,
        database_id: fixture.database,
        table_id: TABLE,
        title: title.to_owned(),
        cell_text: Vec::new(),
        table_version,
        updated_at: 1_763_000_000_000,
    })
}

/// The fixture's row as the index holds it, after a refresh.
async fn indexed(
    client: &opensearch_client::OpensearchClient,
    raw: &opensearch::OpenSearch,
    fixture: &Fixture,
) -> anyhow::Result<Vec<IndexedDatabaseRow>> {
    refresh(raw, "database_rows").await?;
    Ok(client
        .page_database_rows(Some(Uuid::from_u128(fixture.row.as_u128() - 1)), 1)
        .await?
        .into_iter()
        .filter(|indexed| indexed.row_id == fixture.row)
        .collect())
}

#[tokio::test]
async fn an_older_write_landing_after_a_newer_one_changes_nothing() -> anyhow::Result<()> {
    let (client, raw, _) = test_clients()?;
    // Versions above any earlier run's, whose deletes leave tombstones.
    let newer = version_above_earlier_runs();
    client
        .delete_database_rows(DatabaseRowScope::Database(ORDERED.database))
        .await?;

    let written = client
        .write_database_rows(&[row(&ORDERED, "Newer", newer)])
        .await?;
    assert_eq!(
        written,
        DatabaseRowWrites {
            applied: 1,
            superseded: 0
        }
    );

    let late = client
        .write_database_rows(&[
            row(&ORDERED, "Older", newer - 1),
            DatabaseRowWrite::Delete {
                row_id: ORDERED.row,
                table_version: newer - 1,
            },
        ])
        .await?;
    assert_eq!(
        late,
        DatabaseRowWrites {
            applied: 0,
            superseded: 2
        }
    );
    assert_eq!(
        indexed(&client, &raw, &ORDERED).await?,
        vec![IndexedDatabaseRow {
            row_id: ORDERED.row,
            table_version: newer,
        }]
    );

    client
        .delete_database_rows(DatabaseRowScope::Database(ORDERED.database))
        .await?;
    Ok(())
}

#[tokio::test]
async fn a_database_restored_right_after_its_trash_is_indexed_again() -> anyhow::Result<()> {
    let (client, raw, _) = test_clients()?;
    let version = version_above_earlier_runs();
    client
        .write_database_rows(&[row(&RESTORED, "Plan", version)])
        .await?;

    let removed = client
        .delete_database_rows(DatabaseRowScope::Database(RESTORED.database))
        .await?;
    assert_eq!(removed, 1);
    assert_eq!(indexed(&client, &raw, &RESTORED).await?, Vec::new());

    // Restoring changes no table version; the same write must land while the
    // delete's tombstone is still there.
    let restored = client
        .write_database_rows(&[row(&RESTORED, "Plan", version)])
        .await?;
    assert_eq!(
        restored,
        DatabaseRowWrites {
            applied: 1,
            superseded: 0
        }
    );
    assert_eq!(
        indexed(&client, &raw, &RESTORED).await?,
        vec![IndexedDatabaseRow {
            row_id: RESTORED.row,
            table_version: version,
        }]
    );

    client
        .delete_database_rows(DatabaseRowScope::Database(RESTORED.database))
        .await?;
    Ok(())
}

/// Seconds since the epoch, so each run writes above the last one's versions.
fn version_above_earlier_runs() -> i64 {
    let since_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    i64::try_from(since_epoch.as_secs()).unwrap_or(i64::MAX) * 100
}
