use super::*;
use crate::store::InMemoryStorage;

mod hydration_search_changes;

#[test]
fn storage_generation_survives_reopening_and_preserves_existing_records() {
    pollster::block_on(async {
        let query = "query Viewer { user { id } }";
        let data = serde_json::json!({"user": {"id": "viewer"}});
        let variables = serde_json::Map::new();
        let mut original = Engine::new(InMemoryStorage::new());
        original
            .write_query(None, query, None, &variables, &data, None)
            .await
            .unwrap();
        let revision = original.current_revision();
        let first = original.current_storage_generation().await.unwrap();
        assert_eq!(first.get_version_num(), 7);
        assert_eq!(original.current_revision(), revision);
        assert_eq!(original.current_storage_generation().await.unwrap(), first);

        let mut reopened = Engine::new(original.into_storage());
        assert_eq!(reopened.current_storage_generation().await.unwrap(), first);
        assert!(matches!(
            reopened.read_query(None, query, None, &variables).await.unwrap(),
            ReadResult::Hit { data: read } if read == data
        ));
    });
}

#[test]
fn storage_generation_changes_after_logical_clear_and_identity_rebinding() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let first = engine.current_storage_generation().await.unwrap();
        engine.clear().await.unwrap();
        let after_clear = engine.current_storage_generation().await.unwrap();
        assert_ne!(after_clear, first);

        let query = "query Viewer { user { id } }";
        let variables = serde_json::Map::new();
        engine
            .write_query(
                None,
                query,
                None,
                &variables,
                &serde_json::json!({"user": {"id": "one"}}),
                Some("one"),
            )
            .await
            .unwrap();
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            after_clear
        );
        let write = engine
            .write_query(
                None,
                query,
                None,
                &variables,
                &serde_json::json!({"user": {"id": "two"}}),
                Some("two"),
            )
            .await
            .unwrap();
        assert!(write.reset);
        let after_identity_change = engine.current_storage_generation().await.unwrap();
        assert_ne!(after_identity_change, after_clear);
        assert_ne!(after_identity_change, first);
    });
}

#[test]
fn storage_generation_reads_external_clears_and_repairs_invalid_markers() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let first = engine.current_storage_generation().await.unwrap();
        // Storage is authoritative even when this engine receives no reset notification.
        engine.storage.clear().await.unwrap();
        let replacement = engine.current_storage_generation().await.unwrap();
        assert_ne!(replacement, first);

        let mut malformed = Record::default();
        malformed.fields.insert(
            STORAGE_GENERATION_VALUE_FIELD.to_string(),
            crate::value::CacheValue::String("invalid-generation".to_string()),
        );
        engine
            .storage
            .put_batch(vec![(
                EntityKey(STORAGE_GENERATION_META_KEY.into()),
                malformed,
            )])
            .await
            .unwrap();
        let repaired = engine.current_storage_generation().await.unwrap();
        assert_ne!(repaired, replacement);
        assert_eq!(engine.current_storage_generation().await.unwrap(), repaired);
    });
}

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
