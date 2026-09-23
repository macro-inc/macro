use super::*;
use crate::store::InMemoryStorage;

#[test]
fn ordinary_network_refresh_loads_each_cold_batch_only_once() {
    pollster::block_on(async {
        let query = "query Page { user { id soup(input: {limit: 50}) { items { __typename id ... on GraphqlSoupDocument { name } } nextCursor } } }";
        let data = serde_json::json!({"user": {"id": "viewer", "soup": {
            "items": (0..12).map(|id| serde_json::json!({
                "__typename": "GraphqlSoupDocument", "id": id.to_string(), "name": "Cached"
            })).collect::<Vec<_>>(), "nextCursor": null
        }}});
        let variables = serde_json::Map::new();
        let mut original = Engine::new(InMemoryStorage::new());
        original
            .write_query(None, query, Some("Page"), &variables, &data, None)
            .await
            .unwrap();
        let storage = original.into_storage();
        let before = storage.record_get_count();
        let mut reopened = Engine::with_capacity(storage, 1);
        let result = reopened
            .write_query(None, query, Some("Page"), &variables, &data, None)
            .await
            .unwrap();
        assert!(result.changed.is_empty());
        assert!(!result.revision_advanced);
        assert_eq!(reopened.storage().record_get_count() - before, 1);
        assert!(
            matches!(reopened.read_query(None, query, Some("Page"), &variables).await.unwrap(), ReadResult::Hit { data: read } if read == data)
        );
    });
}

#[test]
fn revision_overflow_is_rejected_without_mutating_storage() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine.revision = u64::MAX.to_string().parse().unwrap();

        let result = engine.clear().await;
        assert!(matches!(result, Err(EngineError::RevisionOverflow)));
        assert_eq!(engine.current_revision().to_string(), u64::MAX.to_string());
        assert!(engine.storage().is_empty());
    });
}
