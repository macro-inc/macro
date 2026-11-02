use cache_core::engine::{Engine, EngineError, HydrationScope, NetworkWrite};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::json;

const DOCUMENT: &str = include_str!(
    "../../../../apps/web/src/lib/service-clients/service-storage/graphql/contacts.graphql"
);

#[test]
fn guarded_hydration_binds_fresh_storage_and_survives_engine_replacement() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let scope = HydrationScope {
            storage_generation: engine.current_storage_generation().await.unwrap(),
            identity: "viewer".into(),
        };
        let variables = json!({"limit": 500, "after": null});
        let data = json!({"user": {"id": "viewer", "contacts": {"nodes": [{"id":"contact", "userId":"macro|person@example.com", "email":"person@example.com", "name":null}], "nextCursor": "next"}}});
        let write = NetworkWrite {
            query: DOCUMENT,
            operation_name: Some("ContactDirectoryBackfill"),
            variables: variables.as_object().unwrap(),
            data: &data,
            identity: Some("viewer"),
        };
        let first = engine
            .hydrate_query_in_scope(write, &scope, vec![])
            .await
            .unwrap();
        assert!(!first.write_result.reset);
        assert_eq!(
            engine.current_identity().await.unwrap().as_deref(),
            Some("viewer")
        );
        let mut reopened = Engine::new(engine.into_storage());
        let duplicate = reopened
            .hydrate_query_in_scope(write, &scope, vec![])
            .await
            .unwrap();
        assert!(!duplicate.write_result.revision_advanced);
        assert_eq!(
            duplicate.data.unwrap()["user"]["contacts"],
            json!({"nextCursor": "next"})
        );
        assert_eq!(
            reopened.current_storage_generation().await.unwrap(),
            scope.storage_generation
        );
    });
}

#[test]
fn late_responses_never_repopulate_cleared_storage() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let scope = HydrationScope {
            storage_generation: engine.current_storage_generation().await.unwrap(),
            identity: "viewer".into(),
        };
        engine.clear().await.unwrap();
        // Admission precedes even parsing, and does not recreate missing metadata.
        let write = NetworkWrite {
            query: "obsolete invalid query",
            operation_name: None,
            variables: &serde_json::Map::new(),
            data: &json!({}),
            identity: Some("viewer"),
        };
        assert!(matches!(
            engine.hydrate_query_in_scope(write, &scope, vec![]).await,
            Err(EngineError::StaleHydrationScope)
        ));
        assert!(
            engine
                .storage()
                .get_batch(&[EntityKey("__meta:storage-generation".into())])
                .await
                .unwrap()[0]
                .is_none()
        );
        assert_eq!(engine.current_identity().await.unwrap(), None);
        let new_generation = engine.current_storage_generation().await.unwrap();
        assert_ne!(new_generation, scope.storage_generation);
        assert!(matches!(
            engine.hydrate_query_in_scope(write, &scope, vec![]).await,
            Err(EngineError::StaleHydrationScope)
        ));
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            new_generation
        );
    });
}

#[test]
fn response_and_bound_account_must_both_match_the_captured_scope() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                "{ user { id } }",
                None,
                &serde_json::Map::new(),
                &json!({"user":{"id":"current"}}),
                Some("current"),
            )
            .await
            .unwrap();
        let generation = engine.current_storage_generation().await.unwrap();
        let before = engine.current_revision();
        for (expected, response) in [
            ("current", Some("other")),
            ("other", Some("other")),
            ("current", None),
        ] {
            let scope = HydrationScope {
                storage_generation: generation,
                identity: expected.into(),
            };
            let write = NetworkWrite {
                query: "obsolete invalid query",
                operation_name: None,
                variables: &serde_json::Map::new(),
                data: &json!({}),
                identity: response,
            };
            assert!(matches!(
                engine.hydrate_query_in_scope(write, &scope, vec![]).await,
                Err(EngineError::StaleHydrationScope)
            ));
            assert_eq!(
                engine.current_identity().await.unwrap().as_deref(),
                Some("current")
            );
            assert_eq!(
                engine.current_storage_generation().await.unwrap(),
                generation
            );
            assert_eq!(engine.current_revision(), before);
        }
    });
}
