use cache_core::document::{Document, OperationKind};
use cache_core::engine::{Engine, EngineError};
use cache_core::normalize::normalize;
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey};
use pollster::block_on;
use serde_json::json;

const SOUP_UPDATES_SUBSCRIPTION: &str = r#"
subscription SoupUpdates {
  soupUpdates {
    __typename
    ... on SoupUpdated {
      item {
        __typename
        id
        displayName
      }
    }
    ... on GraphqlCacheDeletion {
      graphqlTypeName
      entityId
    }
  }
}
"#;

fn updated_document(display_name: &str) -> serde_json::Value {
    json!({
        "soupUpdates": [{
            "__typename": "SoupUpdated",
            "item": {
                "__typename": "GraphqlSoupDocument",
                "id": "doc-1",
                "displayName": display_name
            }
        }]
    })
}

#[test]
fn subscription_normalization_persists_entities_but_not_the_root() {
    let document = Document::parse(SOUP_UPDATES_SUBSCRIPTION).unwrap();
    let operation = document.operation(Some("SoupUpdates")).unwrap();
    assert_eq!(operation.kind, OperationKind::Subscription);

    let updates = normalize(
        operation,
        &serde_json::Map::new(),
        &updated_document("Updated"),
    )
    .unwrap();

    assert_eq!(
        updates.keys().collect::<Vec<_>>(),
        vec![&EntityKey("GraphqlSoupDocument:doc-1".into())]
    );
    assert!(!updates.contains_key(&EntityKey::root()));
    assert!(matches!(
        updates[&EntityKey("GraphqlSoupDocument:doc-1".into())]
            .fields
            .get("displayName"),
        Some(CacheValue::String(name)) if name == "Updated"
    ));
}

#[test]
fn engine_writes_subscription_entities_and_keeps_reads_query_only() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                SOUP_UPDATES_SUBSCRIPTION,
                Some("SoupUpdates"),
                &serde_json::Map::new(),
                &updated_document("Updated"),
                None,
            )
            .await
            .unwrap();
        engine
            .write_query(
                None,
                SOUP_UPDATES_SUBSCRIPTION,
                Some("SoupUpdates"),
                &serde_json::Map::new(),
                &updated_document("Updated again"),
                None,
            )
            .await
            .unwrap();

        let keys = [
            EntityKey("GraphqlSoupDocument:doc-1".into()),
            EntityKey::root(),
        ];
        let records = engine.storage().get_batch(&keys).await.unwrap();
        assert!(matches!(
            records[0]
                .as_ref()
                .and_then(|record| record.fields.get("displayName")),
            Some(CacheValue::String(name)) if name == "Updated again"
        ));
        assert!(records[1].is_none());

        let error = engine
            .read_query(
                None,
                SOUP_UPDATES_SUBSCRIPTION,
                Some("SoupUpdates"),
                &serde_json::Map::new(),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, EngineError::Document(_)));
    });
}
