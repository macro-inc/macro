#![cfg(not(target_arch = "wasm32"))]

use cache_core::engine::{BeginOptimisticWrite, Engine, EngineError, ReadResult};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::record_selection::RecordSelection;
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoMemoryDatabase, TursoStorage, TursoStorageCloseOutcome};
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
        ... on GraphqlSoupDocument {
          properties {
            id
            displayName
            value {
              __typename
              ... on GraphqlStringPropertyValue { stringValue: value }
            }
          }
        }
      }
      nextCursor
    }
  }
}
"#;

const MUTATION: &str = r#"
mutation SetEntityProperty($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) {
    id
    displayName
    value {
      __typename
      ... on GraphqlStringPropertyValue { stringValue: value }
    }
  }
}
"#;

fn query_vars() -> serde_json::Map<String, Json> {
    let Json::Object(values) = json!({"input": {"limit": 10}}) else {
        unreachable!()
    };
    values
}

fn mutation_vars(value: &str) -> serde_json::Map<String, Json> {
    let Json::Object(values) = json!({"input": {
        "entityType": "DOCUMENT",
        "entityId": "doc-1",
        "propertyDefinitionId": "definition-1",
        "value": {"string": value}
    }}) else {
        unreachable!()
    };
    values
}

fn page(display_name: &str, value: &str, user: &str) -> Json {
    json!({"user": {"id": user, "soup": {
        "items": [{
            "__typename": "GraphqlSoupDocument",
            "id": "doc-1",
            "properties": [{
                "id": "property-1",
                "displayName": display_name,
                "value": {
                    "__typename": "GraphqlStringPropertyValue",
                    "stringValue": value
                }
            }]
        }],
        "nextCursor": null
    }}})
}

fn mutation_response(display_name: &str, value: &str) -> Json {
    json!({"setEntityProperty": {
        "id": "property-1",
        "displayName": display_name,
        "value": {
            "__typename": "GraphqlStringPropertyValue",
            "stringValue": value
        }
    }})
}

async fn read_value(engine: &mut Engine<TursoStorage>) -> (String, String) {
    let ReadResult::Hit { data } = engine
        .read_query(None, QUERY, Some("Soup"), &query_vars())
        .await
        .unwrap()
    else {
        panic!("expected Turso-backed hit")
    };
    let property = &data["user"]["soup"]["items"][0]["properties"][0];
    (
        property["displayName"].as_str().unwrap().to_owned(),
        property["value"]["stringValue"]
            .as_str()
            .unwrap()
            .to_owned(),
    )
}

#[test]
fn query_identity_cold_tier_selection_and_clear_run_over_turso() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("engine-query").unwrap();
        let mut engine = Engine::with_capacity(storage, 1);
        let original = page("Status", "todo", "user-1");
        engine
            .write_query(
                Some(1),
                QUERY,
                Some("Soup"),
                &query_vars(),
                &original,
                Some("user-1"),
            )
            .await
            .unwrap();
        assert_eq!(
            engine.current_identity().await.unwrap().as_deref(),
            Some("user-1")
        );
        assert_eq!(
            read_value(&mut engine).await,
            ("Status".into(), "todo".into())
        );

        let selection = RecordSelection::parse(
            "fragment Property on GraphqlProperty { id displayName }",
            "Property",
        )
        .unwrap();
        let selected = engine
            .read_records_by_keys(
                &selection,
                &[EntityKey("GraphqlProperty:property-1".into())],
            )
            .await
            .unwrap();
        assert_eq!(
            selected[0].record,
            json!({"id": "property-1", "displayName": "Status"})
        );

        let reset = engine
            .write_query(
                Some(2),
                QUERY,
                Some("Soup"),
                &query_vars(),
                &page("Other", "done", "user-2"),
                Some("user-2"),
            )
            .await
            .unwrap();
        assert!(reset.reset);
        assert_eq!(
            engine.current_identity().await.unwrap().as_deref(),
            Some("user-2")
        );
        engine.clear().await.unwrap();
        assert!(matches!(
            engine
                .read_query(None, QUERY, Some("Soup"), &query_vars())
                .await
                .unwrap(),
            ReadResult::Miss
        ));
    });
}

#[test]
fn optimistic_hydration_retry_complete_and_reopen_run_over_turso() {
    block_on(async {
        let database = TursoMemoryDatabase::new("engine-optimistic-reopen.db");
        let mut engine = Engine::new(database.open("engine-optimistic").unwrap());
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &query_vars(),
                &page("Status", "todo", "user-1"),
                Some("user-1"),
            )
            .await
            .unwrap();
        let (mutation_id, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("doing"),
                    data: &mutation_response("Status", "doing"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 10,
                },
            )
            .await
            .unwrap();
        assert_eq!(read_value(&mut engine).await.1, "doing");
        assert_eq!(
            engine.into_storage().try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );

        let mut reopened = Engine::new(database.open("engine-optimistic").unwrap());
        assert_eq!(read_value(&mut reopened).await.1, "doing");
        let first_claim = reopened
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-a".into(),
                now_ms: 20,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        reopened
            .defer_optimistic_write(
                mutation_id,
                MutationClaimToken {
                    owner: "runner-a".into(),
                    generation: first_claim.lease_generation,
                },
                200,
                "offline".into(),
            )
            .await
            .unwrap();
        assert!(
            reopened
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner-b".into(),
                    now_ms: 199,
                    lease_expires_at_ms: 300,
                })
                .await
                .unwrap()
                .is_none()
        );
        let second_claim = reopened
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner-b".into(),
                now_ms: 200,
                lease_expires_at_ms: 300,
            })
            .await
            .unwrap()
            .unwrap();
        reopened
            .commit_optimistic_write(
                mutation_id,
                MutationClaimToken {
                    owner: "runner-b".into(),
                    generation: second_claim.lease_generation,
                },
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("done"),
                &mutation_response("Status (server)", "done"),
            )
            .await
            .unwrap();
        assert_eq!(
            read_value(&mut reopened).await,
            ("Status (server)".into(), "done".into())
        );
        assert!(
            reopened
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            reopened.into_storage().try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}

#[test]
fn stale_local_head_and_storage_settlement_races_report_stale_claims() {
    block_on(async {
        let database = TursoMemoryDatabase::new("engine-stale-head.db");
        let mut advancing = Engine::new(database.open("engine-stale-head").unwrap());
        advancing
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &query_vars(),
                &page("Status", "todo", "user-1"),
                None,
            )
            .await
            .unwrap();
        let (first, _) = advancing
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("first"),
                    data: &mutation_response("Status", "first"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();
        let (second, _) = advancing
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("second"),
                    data: &mutation_response("Status", "second"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 2,
                },
            )
            .await
            .unwrap();

        let mut stale = Engine::new(database.open("engine-stale-head").unwrap());
        let claimed_first = stale
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 3,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed_first.queued.id, first);
        let first_claim = MutationClaimToken {
            owner: "runner".into(),
            generation: claimed_first.lease_generation,
        };
        advancing
            .rollback_optimistic_write(first, first_claim.clone())
            .await
            .unwrap();

        let error = stale
            .rollback_optimistic_write(first, first_claim)
            .await
            .unwrap_err();
        assert!(matches!(error, EngineError::StaleMutationClaim(id) if id == first));

        let claimed_second = stale
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 4,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed_second.queued.id, second);
        let error = stale
            .rollback_optimistic_write(
                second,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claimed_second.lease_generation,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(error, EngineError::StaleMutationClaim(id) if id == second));
    });
}

#[test]
fn optimistic_discard_restores_durable_base_over_turso() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("engine-discard").unwrap();
        let mut engine = Engine::new(storage);
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &query_vars(),
                &page("Status", "todo", "user-1"),
                None,
            )
            .await
            .unwrap();
        let (mutation_id, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("bad"),
                    data: &mutation_response("Status", "bad"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();
        let claimed = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 2,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .rollback_optimistic_write(
                mutation_id,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claimed.lease_generation,
                },
            )
            .await
            .unwrap();
        assert_eq!(read_value(&mut engine).await.1, "todo");

        let records = engine
            .storage()
            .get_batch(&[EntityKey("GraphqlProperty:property-1".into())])
            .await
            .unwrap();
        let record: &Record = records[0].as_ref().unwrap();
        let CacheValue::Object(value) = record.fields.get("value").unwrap() else {
            panic!("property value object")
        };
        assert_eq!(value.get("value"), Some(&CacheValue::String("todo".into())));
    });
}
