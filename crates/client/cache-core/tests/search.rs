use cache_core::engine::{BeginOptimisticWrite, Engine};
use cache_core::search::{SearchCursor, SearchProfile, SearchRequest};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use serde_json::{Value as Json, json};

const QUERY: &str = r#"
query Soup($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupDocument { documentName: name ownerId }
      }
      nextCursor
    }
  }
}
"#;

fn variables() -> serde_json::Map<String, Json> {
    let Json::Object(variables) = json!({ "input": { "limit": 100 } }) else {
        unreachable!()
    };
    variables
}

fn page(name: &str) -> Json {
    json!({
        "user": {
            "id": "user-1",
            "soup": {
                "items": [{
                    "__typename": "GraphqlSoupDocument",
                    "id": "doc-1",
                    "documentName": name,
                    "ownerId": "user-1"
                }],
                "nextCursor": null
            }
        }
    })
}

const RENAME: &str = r#"
mutation Rename($inputs: [RenameEntityInput!]!) {
  renameEntities(inputs: $inputs) {
    results {
      ... on GraphqlMutationSuccess {
        effects {
          ... on SoupUpdated {
            item {
              __typename
              id
              ... on GraphqlSoupDocument { documentName: name ownerId }
            }
          }
        }
      }
    }
  }
}
"#;

fn request(query: &str, limit: usize) -> SearchRequest {
    SearchRequest {
        profile: SearchProfile::QuickAccessV1,
        buckets: vec!["document".into()],
        query: query.into(),
        cursor: None,
        limit,
        now_ms: 1_000,
    }
}

#[test]
fn text_search_loads_compact_catalog_once_and_never_scans_records() {
    block_on(async {
        let storage = InMemoryStorage::new();
        let diagnostics = storage.clone();
        let mut engine = Engine::new(storage);
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &variables(),
                &page("Alpha Plan"),
                None,
            )
            .await
            .unwrap();
        let gets_before_search = diagnostics.record_get_count();

        let first = engine.search(&request("alpha", 20)).await.unwrap();
        let second = engine.search(&request("plan", 20)).await.unwrap();
        assert_eq!(
            first.documents[0].record_key.as_ref(),
            "GraphqlSoupDocument:doc-1"
        );
        assert_eq!(second.documents.len(), 1);
        assert_eq!(diagnostics.search_catalog_load_count(), 1);
        assert_eq!(diagnostics.record_get_count(), gets_before_search);

        // A write-through update patches the loaded catalog incrementally.
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &variables(),
                &page("Beta Plan"),
                None,
            )
            .await
            .unwrap();
        assert!(
            engine
                .search(&request("alpha", 20))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
        assert_eq!(
            engine
                .search(&request("beta", 20))
                .await
                .unwrap()
                .documents
                .len(),
            1
        );
        assert_eq!(diagnostics.search_catalog_load_count(), 1);

        engine
            .delete_keys(&[EntityKey::entity("GraphqlSoupDocument", &["doc-1"])])
            .await
            .unwrap();
        assert!(
            engine
                .search(&request("beta", 20))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
    });
}

#[test]
fn unnamed_notes_are_browsable_without_matching_ui_fallback_text() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let entries = ["note-1", "note-2"].map(|id| {
            let mut record = Record::default();
            record.fields.insert(
                "__typename".into(),
                CacheValue::String("GraphqlSoupDocument".into()),
            );
            record
                .fields
                .insert("name".into(), CacheValue::String(String::new()));
            record
                .fields
                .insert("fileType".into(), CacheValue::String("md".into()));
            (EntityKey::entity("GraphqlSoupDocument", &[id]), record)
        });
        storage.put_batch(entries.into()).await.unwrap();
        let mut engine = Engine::new(storage);
        let mut browse = request("", 20);
        browse.buckets = vec!["note".into()];

        let page = engine.search(&browse).await.unwrap();
        assert_eq!(
            page.documents
                .iter()
                .map(|document| (document.record_key.as_ref(), document.search_text.as_str()))
                .collect::<Vec<_>>(),
            [
                ("GraphqlSoupDocument:note-1", ""),
                ("GraphqlSoupDocument:note-2", "")
            ]
        );

        let mut text_search = request("new note", 20);
        text_search.buckets = vec!["note".into()];
        assert!(
            engine
                .search(&text_search)
                .await
                .unwrap()
                .documents
                .is_empty()
        );
    });
}

#[test]
fn optimistic_records_explicitly_overlay_the_durable_search_catalog() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &variables(),
                &page("Alpha Plan"),
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            engine
                .search(&request("alpha", 20))
                .await
                .unwrap()
                .documents
                .len(),
            1
        );

        let Json::Object(rename_variables) = json!({
            "inputs": [{
                "entity": { "type": "DOCUMENT", "id": "doc-1" },
                "displayName": "Beta Plan"
            }]
        }) else {
            unreachable!()
        };
        let optimistic = json!({
            "renameEntities": {
                "results": [{
                    "__typename": "GraphqlMutationSuccess",
                    "effects": [{
                        "__typename": "SoupUpdated",
                        "item": {
                            "__typename": "GraphqlSoupDocument",
                            "id": "doc-1",
                            "documentName": "Beta Plan",
                            "ownerId": "user-1"
                        }
                    }]
                }]
            }
        });
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    uuid: "00000000-0000-4000-8000-000000000020",
                    query: RENAME,
                    operation_name: Some("Rename"),
                    variables: &rename_variables,
                    data: &optimistic,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();

        assert!(
            engine
                .search(&request("alpha", 20))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
        assert_eq!(
            engine
                .search(&request("beta", 20))
                .await
                .unwrap()
                .documents
                .len(),
            1
        );
    });
}

#[test]
fn in_memory_recent_browse_uses_component_wise_record_key_order() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let entries = ["Type:9", "Type0:1"].map(|key| {
            let mut record = Record::default();
            record.fields.insert(
                "__typename".into(),
                CacheValue::String("GraphqlSoupDocument".into()),
            );
            record
                .fields
                .insert("name".into(), CacheValue::String(key.into()));
            record.fields.insert(
                "updatedAt".into(),
                CacheValue::Number(cache_core::value::CacheNumber::PosInt(1)),
            );
            (EntityKey(key.into()), record)
        });
        storage.put_batch(entries.into()).await.unwrap();

        let first = storage
            .browse_search_documents(SearchProfile::QuickAccessV1, "document", None, 1)
            .await
            .unwrap();
        assert_eq!(first[0].record_key.as_ref(), "Type:9");

        let cursor = SearchCursor {
            timestamp_ms: first[0].timestamp_ms,
            record_key: first[0].record_key.clone(),
        };
        let second = storage
            .browse_search_documents(SearchProfile::QuickAccessV1, "document", Some(&cursor), 1)
            .await
            .unwrap();
        assert_eq!(second[0].record_key.as_ref(), "Type0:1");
    });
}

#[test]
fn empty_query_is_bounded_and_uses_recent_projection_path() {
    block_on(async {
        let mut storage = InMemoryStorage::new();
        let entries = (0..1_000)
            .map(|index| {
                let mut record = Record::default();
                record.fields.insert(
                    "__typename".into(),
                    CacheValue::String("GraphqlSoupDocument".into()),
                );
                record.fields.insert(
                    "name".into(),
                    CacheValue::String(format!("Document {index}")),
                );
                record.fields.insert(
                    "updatedAt".into(),
                    CacheValue::Number(cache_core::value::CacheNumber::PosInt(index)),
                );
                (
                    EntityKey::entity("GraphqlSoupDocument", &[&index.to_string()]),
                    record,
                )
            })
            .collect();
        storage.put_batch(entries).await.unwrap();
        let diagnostics = storage.clone();
        let mut engine = Engine::new(storage);

        let page = engine.search(&request("", 25)).await.unwrap();
        assert_eq!(page.documents.len(), 25);
        assert_eq!(page.documents[0].timestamp_ms, 999);
        assert!(page.next_cursor.is_some());
        assert_eq!(diagnostics.search_catalog_load_count(), 0);
        assert_eq!(diagnostics.record_get_count(), 0);
    });
}
