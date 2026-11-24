use models_opensearch::database_row::DatabaseRowDocument;
use serde_json::json;
use uuid::{Uuid, uuid};

use super::*;

const ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000001");
const DATABASE: Uuid = uuid!("10000000-0000-7000-8000-000000000001");
const TABLE: Uuid = uuid!("20000000-0000-7000-8000-000000000001");

fn document(title: &str, table_version: i64) -> DatabaseRowDocument {
    DatabaseRowDocument {
        row_id: ROW,
        database_id: DATABASE,
        table_id: TABLE,
        title: title.to_owned(),
        cell_text: vec!["Planning".to_owned()],
        table_version,
        updated_at: 1_795_000_000_000,
    }
}

#[test]
fn every_write_carries_its_table_version_as_an_external_gte_version() {
    let body = bulk_body(&[
        DatabaseRowWrite::Upsert(document("Launch", 7)),
        DatabaseRowWrite::Delete {
            row_id: uuid!("60000000-0000-7000-8000-000000000002"),
            table_version: 8,
        },
    ])
    .unwrap();

    let lines: Vec<serde_json::Value> = body
        .iter()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        lines,
        vec![
            json!({"index": {"_id": ROW, "version": 7, "version_type": "external_gte"}}),
            json!({
                "row_id": ROW,
                "database_id": DATABASE,
                "table_id": TABLE,
                "title": "Launch",
                "cell_text": ["Planning"],
                "table_version": 7,
                "updated_at": 1_795_000_000_000_i64,
            }),
            json!({"delete": {
                "_id": "60000000-0000-7000-8000-000000000002",
                "version": 8,
                "version_type": "external_gte",
            }}),
        ]
    );
}

#[test]
fn a_newer_indexed_version_or_an_absent_document_is_not_a_failure() {
    let answer = json!({"errors": true, "items": [
        {"index": {"_id": "a", "status": 201, "result": "created"}},
        {"index": {"_id": "b", "status": 409, "error": {"type": "version_conflict_engine_exception", "reason": "current version [9] is higher"}}},
        {"delete": {"_id": "c", "status": 404, "result": "not_found"}},
    ]});

    let writes = classify_bulk_answer(200, &answer.to_string()).unwrap();

    assert_eq!(
        writes,
        DatabaseRowWrites {
            applied: 2,
            superseded: 1,
        }
    );
}

#[test]
fn any_other_failed_item_fails_the_batch() {
    let answer = json!({"errors": true, "items": [
        {"index": {"_id": "a", "status": 201, "result": "created"}},
        {"index": {"_id": "b", "status": 429, "error": {"type": "es_rejected_execution_exception", "reason": "queue full"}}},
    ]});

    let error = classify_bulk_answer(200, &answer.to_string()).unwrap_err();

    assert!(matches!(
        error,
        OpensearchClientError::BulkItemsFailed {
            failed: 1,
            total: 2,
            ..
        }
    ));
}

/// Uses a uniquely named scratch index behind its own alias; never touches
/// application indices.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn an_older_state_never_overwrites_a_newer_one() {
    use opensearch::indices::{IndicesDeleteParts, IndicesPutAliasParts};

    let client =
        crate::OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap();
    let alias = format!("database-rows-test-{}", Uuid::new_v4());
    let index = format!("{alias}_v1");
    client
        .ensure_index_exists(
            &index,
            json!({
                "settings": {"number_of_shards": 1, "number_of_replicas": 0},
                "mappings": {"dynamic": "false", "properties": {
                    "row_id": {"type": "keyword"},
                    "database_id": {"type": "keyword"},
                    "table_id": {"type": "keyword"},
                    "title": {"type": "text"},
                    "cell_text": {"type": "text"},
                    "table_version": {"type": "long"},
                    "updated_at": {"type": "date", "format": "epoch_millis"},
                }},
            }),
        )
        .await
        .unwrap();
    client
        .inner
        .indices()
        .put_alias(IndicesPutAliasParts::IndexName(&[&index], &alias))
        .send()
        .await
        .unwrap()
        .error_for_status_code()
        .unwrap();

    let result: anyhow::Result<()> = async {
        let written = write_rows(
            &client.inner,
            &alias,
            &[DatabaseRowWrite::Upsert(document("Newer", 9))],
        )
        .await?;
        assert_eq!(
            written,
            DatabaseRowWrites {
                applied: 1,
                superseded: 0
            }
        );

        // A delayed write and a delayed delete from version 8 are refused.
        let late = write_rows(
            &client.inner,
            &alias,
            &[
                DatabaseRowWrite::Upsert(document("Older", 8)),
                DatabaseRowWrite::Delete {
                    row_id: ROW,
                    table_version: 8,
                },
            ],
        )
        .await?;
        assert_eq!(
            late,
            DatabaseRowWrites {
                applied: 0,
                superseded: 2
            }
        );

        // Replaying version 9 applies again and changes nothing.
        let replayed = write_rows(
            &client.inner,
            &alias,
            &[DatabaseRowWrite::Upsert(document("Newer", 9))],
        )
        .await?;
        assert_eq!(
            replayed,
            DatabaseRowWrites {
                applied: 1,
                superseded: 0
            }
        );

        client
            .inner
            .indices()
            .refresh(opensearch::indices::IndicesRefreshParts::Index(&[&alias]))
            .send()
            .await?
            .error_for_status_code()?;
        let page = page_rows(&client.inner, &alias, None, 10).await?;
        assert_eq!(
            page,
            vec![IndexedDatabaseRow {
                row_id: ROW,
                table_version: 9
            }]
        );

        // A sweep below version 9 keeps the row; one below 10 removes it.
        let kept = delete_rows(
            &client.inner,
            &alias,
            DatabaseRowScope::TableOlderThan {
                table_id: TABLE,
                version: 9,
            },
        )
        .await?;
        assert_eq!(kept, 0);
        let removed = delete_rows(
            &client.inner,
            &alias,
            DatabaseRowScope::TableOlderThan {
                table_id: TABLE,
                version: 10,
            },
        )
        .await?;
        assert_eq!(removed, 1);
        Ok(())
    }
    .await;

    client
        .inner
        .indices()
        .delete(IndicesDeleteParts::Index(&[&index]))
        .send()
        .await
        .unwrap();
    result.unwrap();
}
