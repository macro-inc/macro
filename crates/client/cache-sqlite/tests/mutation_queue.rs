use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_sqlite::SqliteStorage;
use pollster::block_on;

const CACHE_QUERY: &str = r#"
query Soup($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupDocument {
          properties { id displayName }
        }
      }
      hasMore
    }
  }
}
"#;

const CACHE_MUTATION: &str = r#"
mutation SetEntityProperty($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id displayName }
}
"#;

fn queued(value: &str) -> NewQueuedMutation {
    let mut update = Record::default();
    update
        .fields
        .insert("name".into(), CacheValue::String(value.into()));
    NewQueuedMutation {
        mutation: StoredMutation::new(
            MutationRequest {
                query: "mutation Rename { rename { id } }".into(),
                operation_name: Some("Rename".into()),
                variables_json: format!(r#"{{"name":"{value}"}}"#),
                identity: Some("user-1".into()),
            },
            10,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: format!(r#"{{"rename":{{"name":"{value}"}}}}"#),
            normalized_updates: [(EntityKey("Thing:1".into()), update)].into(),
        },
    }
}

#[test]
fn queue_and_optimistic_layer_survive_reopen() {
    block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.db");
        let mut storage = SqliteStorage::open(&path, "scope-1").unwrap();
        let id = storage
            .enqueue_mutation(queued("optimistic"))
            .await
            .unwrap();
        drop(storage);

        let mut storage = SqliteStorage::open(&path, "scope-1").unwrap();
        let loaded = storage.load_mutation_queue().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, id);
        assert_eq!(
            loaded[0].optimistic.optimistic_data_json,
            r#"{"rename":{"name":"optimistic"}}"#
        );

        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 20,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        let mut real = Record::default();
        real.fields
            .insert("name".into(), CacheValue::String("server".into()));
        assert!(
            storage
                .complete_mutation(
                    id,
                    MutationClaimToken {
                        owner: "runner".into(),
                        generation: claimed.lease_generation,
                    },
                    vec![(EntityKey("Thing:1".into()), real.clone())],
                )
                .await
                .unwrap()
        );
        drop(storage);

        let storage = SqliteStorage::open(&path, "scope-1").unwrap();
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());
        assert_eq!(
            storage
                .get_batch(&[EntityKey("Thing:1".into())])
                .await
                .unwrap()[0],
            Some(real)
        );
    });
}

#[test]
fn restart_hydration_preserves_legacy_json_with_envelope_keys() {
    use cache_core::engine::{Engine, ReadResult};
    use serde_json::json;

    block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.db");
        let serde_json::Value::Object(query_vars) = json!({"input": {"limit": 1}}) else {
            unreachable!()
        };
        let serde_json::Value::Object(mutation_vars) = json!({"input": {
            "entityType": "DOCUMENT",
            "entityId": "doc-1",
            "propertyDefinitionId": "def-1",
            "value": {"string": "x"}
        }}) else {
            unreachable!()
        };
        let base = json!({"user": {"id": "user-1", "soup": {
            "items": [{
                "__typename": "GraphqlSoupDocument",
                "id": "doc-1",
                "properties": [{"id": "prop-1", "displayName": "Status"}]
            }],
            "hasMore": false
        }}});
        let optimistic = json!({
            "version": 2,
            "mutationData": {"colliding": true},
            "setEntityProperty": {
                "id": "prop-1",
                "displayName": "Stage"
            }
        });

        let mut engine = Engine::new(SqliteStorage::open(&path, "scope-1").unwrap());
        engine
            .write_query(
                None,
                CACHE_QUERY,
                Some("Soup"),
                &query_vars,
                &base,
                Some("user-1"),
            )
            .await
            .unwrap();
        drop(engine);

        let mut storage = SqliteStorage::open(&path, "scope-1").unwrap();
        storage
            .enqueue_mutation(NewQueuedMutation {
                mutation: StoredMutation::new(
                    MutationRequest {
                        query: CACHE_MUTATION.to_string(),
                        operation_name: Some("SetEntityProperty".to_string()),
                        variables_json: serde_json::to_string(&mutation_vars).unwrap(),
                        identity: Some("user-1".to_string()),
                    },
                    10,
                ),
                optimistic: PersistedOptimisticLayer {
                    optimistic_data_json: serde_json::to_string(&optimistic).unwrap(),
                    normalized_updates: Default::default(),
                },
            })
            .await
            .unwrap();
        drop(storage);

        let mut reopened = Engine::new(SqliteStorage::open(&path, "scope-1").unwrap());
        let ReadResult::Hit { data } = reopened
            .read_query(None, CACHE_QUERY, Some("Soup"), &query_vars)
            .await
            .unwrap()
        else {
            panic!("expected hydrated hit");
        };
        assert_eq!(
            data["user"]["soup"]["items"][0]["properties"][0]["displayName"],
            json!("Stage")
        );
    });
}

#[test]
fn scope_change_clears_queued_user_intent() {
    block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.db");
        let mut storage = SqliteStorage::open(&path, "scope-1").unwrap();
        storage.enqueue_mutation(queued("a")).await.unwrap();
        drop(storage);

        let storage = SqliteStorage::open(&path, "scope-2").unwrap();
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    });
}
