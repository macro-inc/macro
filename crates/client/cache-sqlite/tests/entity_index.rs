use cache_core::engine::Engine;
use cache_core::entity_index::{EntityBucket, EntityIndexCursor, EntityIndexQuery};
use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_sqlite::SqliteStorage;
use pollster::block_on;
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeMap;

fn document(kind: Option<&str>, timestamp: &str) -> Record {
    let mut fields: BTreeMap<_, _> = [
        (
            "__typename".into(),
            CacheValue::String("GraphqlSoupDocument".into()),
        ),
        ("viewedAt".into(), CacheValue::String(timestamp.into())),
        ("fileType".into(), CacheValue::String("md".into())),
    ]
    .into_iter()
    .collect();
    if let Some(kind) = kind {
        fields.insert(
            "subType".into(),
            CacheValue::Object(
                [("kind".into(), CacheValue::String(kind.into()))]
                    .into_iter()
                    .collect(),
            ),
        );
    }
    Record { fields }
}

fn stored_metadata(connection: &Connection, key: &str) -> (Option<String>, Option<i64>) {
    connection
        .query_row(
            "SELECT bucket, sort_timestamp FROM records WHERE key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

fn queued_mutation() -> NewQueuedMutation {
    NewQueuedMutation {
        mutation: StoredMutation::new(
            MutationRequest {
                query: "mutation Rename { rename { id } }".into(),
                operation_name: Some("Rename".into()),
                variables_json: "{}".into(),
                identity: Some("user-1".into()),
            },
            10,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: "{}".into(),
            normalized_updates: Default::default(),
        },
    }
}

#[test]
fn record_upserts_maintain_bucket_and_sort_timestamp() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cache.sqlite");
    let mut storage = SqliteStorage::open(&path, "scope").unwrap();
    let key = EntityKey::entity("GraphqlSoupDocument", &["doc-1"]);

    block_on(storage.put_batch(vec![(key.clone(), document(None, "1970-01-01T00:00:01Z"))]))
        .unwrap();
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        stored_metadata(&connection, &key.0),
        (Some("note".into()), Some(1_000))
    );

    block_on(storage.put_batch(vec![(
        key.clone(),
        document(Some("task"), "1970-01-01T00:00:02Z"),
    )]))
    .unwrap();
    assert_eq!(
        stored_metadata(&connection, &key.0),
        (Some("task".into()), Some(2_000))
    );

    let mut deleted = document(Some("task"), "1970-01-01T00:00:03Z");
    deleted.fields.insert(
        "deletedAt".into(),
        CacheValue::String("1970-01-01T00:00:03Z".into()),
    );
    block_on(storage.put_batch(vec![(key.clone(), deleted)])).unwrap();
    assert_eq!(stored_metadata(&connection, &key.0), (None, None));
}

#[test]
fn queries_all_and_selected_buckets_with_an_exclusive_cursor() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("query-cache.sqlite");
    let mut storage = SqliteStorage::open(&path, "scope").unwrap();
    let task_key = EntityKey::entity("GraphqlSoupDocument", &["doc-a"]);
    let note_key = EntityKey::entity("GraphqlSoupDocument", &["doc-b"]);
    let old_note_key = EntityKey::entity("GraphqlSoupDocument", &["doc-c"]);
    block_on(storage.put_batch(vec![
        (note_key.clone(), document(None, "1970-01-01T00:00:03Z")),
        (
            task_key.clone(),
            document(Some("task"), "1970-01-01T00:00:03Z"),
        ),
        (old_note_key.clone(), document(None, "1970-01-01T00:00:01Z")),
    ]))
    .unwrap();

    let first = block_on(storage.query_entity_index(&EntityIndexQuery {
        buckets: Vec::new(),
        cursor: None,
        limit: 2,
        include_total_count: false,
    }))
    .unwrap();
    assert_eq!(
        first
            .iter()
            .map(|entry| entry.entity_key.clone())
            .collect::<Vec<_>>(),
        vec![task_key.clone(), note_key.clone()]
    );

    let selected = block_on(storage.query_entity_index(&EntityIndexQuery {
        buckets: vec![EntityBucket::Document],
        cursor: None,
        limit: 10,
        include_total_count: false,
    }))
    .unwrap();
    assert_eq!(
        selected
            .iter()
            .map(|entry| entry.entity_key.clone())
            .collect::<Vec<_>>(),
        vec![task_key, note_key.clone(), old_note_key.clone()]
    );

    let second = block_on(storage.query_entity_index(&EntityIndexQuery {
        buckets: vec![EntityBucket::Document],
        cursor: Some(EntityIndexCursor {
            sort_timestamp: first[1].sort_timestamp,
            entity_key: first[1].entity_key.clone(),
        }),
        limit: 2,
        include_total_count: false,
    }))
    .unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].entity_key, old_note_key);
}

#[test]
fn normalized_soup_response_persists_entity_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("normalized-cache.sqlite");
    let storage = SqliteStorage::open(&path, "scope").unwrap();
    let mut engine = Engine::new(storage);
    let query = r#"
        query Soup($input: SoupInput!) {
            user {
                id
                soup(input: $input) {
                    items {
                        id
                        entity {
                            __typename
                            ... on GraphqlSoupDocument {
                                id
                                name
                                fileType
                                createdAt
                                updatedAt
                                viewedAt
                                deletedAt
                                subType { kind isCompleted }
                            }
                        }
                    }
                    nextCursor
                    hasMore
                }
            }
        }
    "#;
    let serde_json::Value::Object(variables) = serde_json::json!({
        "input": { "limit": 1 }
    }) else {
        unreachable!()
    };
    let data = serde_json::json!({
        "user": {
            "id": "user-1",
            "soup": {
                "items": [{
                    "id": "item-1",
                    "entity": {
                        "__typename": "GraphqlSoupDocument",
                        "id": "doc-1",
                        "name": "A note",
                        "fileType": "md",
                        "createdAt": "1970-01-01T00:00:01Z",
                        "updatedAt": "1970-01-01T00:00:02Z",
                        "viewedAt": "1970-01-01T00:00:03Z",
                        "deletedAt": null,
                        "subType": null
                    }
                }],
                "nextCursor": null,
                "hasMore": false
            }
        }
    });

    block_on(engine.write_query(None, query, Some("Soup"), &variables, &data, None)).unwrap();

    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        stored_metadata(&connection, "GraphqlSoupDocument:doc-1"),
        (Some("note".into()), Some(3_000))
    );
}

#[test]
fn committed_mutations_maintain_bucket_and_sort_timestamp() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mutation-cache.sqlite");
    let mut storage = SqliteStorage::open(&path, "scope").unwrap();
    let mutation_id = block_on(storage.enqueue_mutation(queued_mutation())).unwrap();
    let claimed = block_on(storage.claim_next_mutation(MutationClaimRequest {
        owner: "runner".into(),
        now_ms: 20,
        lease_expires_at_ms: 100,
    }))
    .unwrap()
    .unwrap();
    let key = EntityKey::entity("GraphqlSoupDocument", &["snippet-1"]);

    assert!(
        block_on(storage.complete_mutation(
            mutation_id,
            MutationClaimToken {
                owner: "runner".into(),
                generation: claimed.lease_generation,
            },
            vec![(
                key.clone(),
                document(Some("snippet"), "1970-01-01T00:00:04Z"),
            )],
        ))
        .unwrap()
    );

    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        stored_metadata(&connection, &key.0),
        (Some("snippet".into()), Some(4_000))
    );
}

#[test]
fn opening_an_old_records_table_adds_index_columns_and_indexes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old-cache.sqlite");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE records (
                 key TEXT PRIMARY KEY,
                 value BLOB NOT NULL
             );",
        )
        .unwrap();
    drop(connection);

    let storage = SqliteStorage::open(&path, "scope").unwrap();
    drop(storage);
    let connection = Connection::open(&path).unwrap();

    let columns = {
        let mut statement = connection.prepare("PRAGMA table_info(records)").unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert!(columns.iter().any(|column| column == "bucket"));
    assert!(columns.iter().any(|column| column == "sort_timestamp"));

    for index in ["records_by_sort", "records_by_bucket_sort"] {
        let found: Option<String> = connection
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?1",
                params![index],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(found.as_deref(), Some(index));
    }
}
