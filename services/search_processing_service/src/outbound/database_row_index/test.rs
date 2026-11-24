use std::sync::Arc;

use opensearch_client::{OpensearchClient, database_row::DatabaseRowScope};
use sqlx::PgPool;
use uuid::{Uuid, uuid};

use super::*;
use crate::domain::database_row_index::{
    DatabaseRowIndexService, PassKind, TableOutcome, TableSelection,
};

const DATABASE: Uuid = uuid!("10000000-0000-7000-8000-000000000001");
const TABLE: Uuid = uuid!("20000000-0000-7000-8000-000000000001");
const LAUNCH_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000001");
const EMPTY_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000002");

/// Reads the indexed `(row, title, cell_text, version)` of the database.
async fn indexed(client: &OpensearchClient) -> Vec<(Uuid, String, Vec<String>, i64)> {
    let http = reqwest::Client::new();
    http.post("http://localhost:9200/database_rows/_refresh")
        .send()
        .await
        .unwrap();
    let answer: serde_json::Value = http
        .post("http://localhost:9200/database_rows/_search")
        .json(&serde_json::json!({
            "query": {"term": {"database_id": DATABASE}},
            "sort": [{"row_id": "asc"}],
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let _ = client;
    answer["hits"]["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| {
            let source = &hit["_source"];
            (
                source["row_id"].as_str().unwrap().parse().unwrap(),
                source["title"].as_str().unwrap().to_owned(),
                serde_json::from_value(source["cell_text"].clone()).unwrap(),
                source["table_version"].as_i64().unwrap(),
            )
        })
        .collect()
}

/// Runs the real adapters over a migrated database and a local OpenSearch
/// whose `database_rows` alias `create_indices.ts` made. It removes the
/// fixture database's documents before and after.
#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../crates/database_row_search/fixtures",
        scripts("rows")
    )
)]
#[ignore = "requires local OpenSearch at http://localhost:9200 with the database_rows alias"]
async fn indexes_relabels_and_removes_a_database(pool: PgPool) {
    let client = Arc::new(
        OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap(),
    );
    client
        .delete_database_rows(DatabaseRowScope::Database(DATABASE))
        .await
        .unwrap();
    // Versions only grow, and a rerun's deletes leave tombstones at the last
    // run's versions for a minute, so each run starts above every earlier one.
    let base: i64 = chrono::Utc::now().timestamp();
    sqlx::query("UPDATE database_tables SET version = $1 WHERE id = $2")
        .bind(base)
        .bind(TABLE)
        .execute(&pool)
        .await
        .unwrap();
    let service = DatabaseRowIndexService::new(
        PgDatabaseRows::new(pool.clone()),
        OpenSearchDatabaseRows(client.clone()),
    );

    service
        .reconcile_database(DATABASE, TableSelection::All, PassKind::CatchUp)
        .await
        .unwrap();
    assert_eq!(
        indexed(&client).await,
        vec![
            (
                LAUNCH_ROW,
                "Launch with Ada Lovelace".to_owned(),
                vec![
                    "Launched".to_owned(),
                    "Planning".to_owned(),
                    "https://example.com/launch".to_owned(),
                    "urgent".to_owned(),
                    "3".to_owned(),
                ],
                base,
            ),
            (EMPTY_ROW, String::new(), Vec::new(), base),
        ]
    );

    // An option relabelled in the next version names no row; the table is
    // reindexed.
    sqlx::raw_sql(&format!(
        "UPDATE property_options SET string_value = 'Shipped' WHERE id = '40000000-0000-7000-8000-000000000002';
         UPDATE database_tables SET version = {next} WHERE id = '20000000-0000-7000-8000-000000000001';
         INSERT INTO database_changes (id, database_id, table_id, version, ops, inverse)
             VALUES (201, '10000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', {next}, '[]', '{{}}');
         INSERT INTO database_change_columns (change_id, column_id, kind)
             VALUES (201, '50000000-0000-7000-8000-000000000002', 'update_option');",
        next = base + 1,
    ))
    .execute(&pool)
    .await
    .unwrap();
    let outcome = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();
    assert_eq!(outcome, TableOutcome::Reindexed);
    assert_eq!(indexed(&client).await[0].2[0], "Shipped");
    assert_eq!(indexed(&client).await[0].3, base + 1);

    // A replay of the same event finds the table caught up.
    let replayed = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();
    assert_eq!(replayed, TableOutcome::UpToDate);

    // Trashed: every document of the database leaves the index.
    sqlx::query("UPDATE database_entities SET trashed_at = now() WHERE database_id = $1")
        .bind(DATABASE)
        .execute(&pool)
        .await
        .unwrap();
    service
        .reconcile_database(DATABASE, TableSelection::All, PassKind::CatchUp)
        .await
        .unwrap();
    assert_eq!(indexed(&client).await, Vec::new());

    // Restored at once, while the deletes' tombstones still hold that version:
    // the rows come back at that same version.
    sqlx::query("UPDATE database_entities SET trashed_at = NULL WHERE database_id = $1")
        .bind(DATABASE)
        .execute(&pool)
        .await
        .unwrap();
    service
        .reconcile_database(DATABASE, TableSelection::All, PassKind::CatchUp)
        .await
        .unwrap();
    let restored: Vec<(Uuid, i64)> = indexed(&client)
        .await
        .into_iter()
        .map(|(row_id, _, _, version)| (row_id, version))
        .collect();
    assert_eq!(
        restored,
        vec![(LAUNCH_ROW, base + 1), (EMPTY_ROW, base + 1)]
    );

    client
        .delete_database_rows(DatabaseRowScope::Database(DATABASE))
        .await
        .unwrap();
}
