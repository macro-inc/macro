//! Durable optimistic mutation tests: enqueue/read/claim/retry/commit/fail,
//! strict ordering, and lifecycle resets.

use cache_core::engine::{Engine, EngineError, ReadResult};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey};
use pollster::block_on;
use serde_json::{Value as Json, json};

const QUERY: &str = r#"
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
      }
      hasMore
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

const PROPERTY_KEY: &str = "GraphqlProperty:prop-1";

fn query_vars() -> serde_json::Map<String, Json> {
    let Json::Object(map) = json!({ "input": { "limit": 10 } }) else {
        unreachable!()
    };
    map
}

fn mutation_vars(value: &str) -> serde_json::Map<String, Json> {
    let Json::Object(map) = json!({
        "input": {
            "entityType": "DOCUMENT",
            "entityId": "doc-1",
            "propertyDefinitionId": "def-1",
            "value": { "string": value }
        }
    }) else {
        unreachable!()
    };
    map
}

fn soup_page(display_name: &str, value: &str) -> Json {
    json!({
        "user": {
            "id": "user-1",
            "soup": {
                "items": [{
                    "id": "item-1",
                    "entity": {
                        "__typename": "GraphqlSoupDocument",
                        "id": "doc-1",
                        "properties": [{
                            "id": "prop-1",
                            "displayName": display_name,
                            "value": {
                                "__typename": "GraphqlStringPropertyValue",
                                "stringValue": value
                            }
                        }]
                    }
                }],
                "hasMore": false
            }
        }
    })
}

fn mutation_response(display_name: &str, value: &str) -> Json {
    json!({
        "setEntityProperty": {
            "id": "prop-1",
            "displayName": display_name,
            "value": {
                "__typename": "GraphqlStringPropertyValue",
                "stringValue": value
            }
        }
    })
}

fn property_of(data: &Json) -> &Json {
    &data["user"]["soup"]["items"][0]["entity"]["properties"][0]
}

async fn engine_with_base(display_name: &str, value: &str) -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    engine
        .write_query(
            None,
            QUERY,
            Some("Soup"),
            &query_vars(),
            &soup_page(display_name, value),
            None,
        )
        .await
        .unwrap();
    engine
}

async fn read_hit(engine: &mut Engine<InMemoryStorage>, op: Option<u64>) -> Json {
    match engine
        .read_query(op, QUERY, Some("Soup"), &query_vars())
        .await
        .unwrap()
    {
        ReadResult::Hit { data } => data,
        ReadResult::Miss => panic!("expected hit"),
    }
}

async fn claim_head(
    engine: &mut Engine<InMemoryStorage>,
    owner: &str,
    now_ms: i64,
) -> (u64, MutationClaimToken) {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: owner.into(),
            now_ms,
            lease_expires_at_ms: now_ms + 1_000,
        })
        .await
        .unwrap()
        .expect("queue head");
    let id = claimed.queued.id;
    (
        id,
        MutationClaimToken {
            owner: owner.into(),
            generation: claimed.lease_generation,
        },
    )
}

async fn durable_value(engine: &Engine<InMemoryStorage>) -> Option<String> {
    let records = engine
        .storage()
        .get_batch(&[EntityKey(PROPERTY_KEY.to_string())])
        .await
        .unwrap();
    let record = records.into_iter().next().flatten()?;
    let CacheValue::Object(value) = record.fields.get("value")? else {
        return None;
    };
    match value.get("value") {
        Some(CacheValue::String(value)) => Some(value.clone()),
        _ => None,
    }
}

#[test]
fn begin_persists_mutation_and_optimistic_layer() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;
        let (transaction, result) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
                123,
            )
            .await
            .unwrap();

        assert!(result.affected_ops.contains(&1));
        let queued = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].id, transaction);
        assert_eq!(queued[0].mutation.created_at_ms, 123);
        assert_eq!(
            queued[0].mutation.request.operation_name.as_deref(),
            Some("SetEntityProperty")
        );

        let data = read_hit(&mut engine, None).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("doing"));
        assert_eq!(durable_value(&engine).await.as_deref(), Some("todo"));
    });
}

#[test]
fn claimed_success_atomically_commits_real_response() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;
        let (transaction, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
                0,
            )
            .await
            .unwrap();
        let (claimed_id, claim) = claim_head(&mut engine, "runner", 10).await;
        assert_eq!(claimed_id, transaction);

        let result = engine
            .commit_optimistic_write(
                transaction,
                claim,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status (server)", "done"),
            )
            .await
            .unwrap();
        assert!(result.changed.contains(&EntityKey(PROPERTY_KEY.into())));
        assert!(result.affected_ops.contains(&1));
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(durable_value(&engine).await.as_deref(), Some("done"));

        let data = read_hit(&mut engine, None).await;
        assert_eq!(property_of(&data)["displayName"], json!("Status (server)"));
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("done"));
    });
}

#[test]
fn retryable_failure_keeps_optimistic_layer_and_blocks_later_mutations() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        let (first, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("a"),
                &mutation_response("Status", "a"),
                0,
            )
            .await
            .unwrap();
        let (second, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("b"),
                &mutation_response("Status", "b"),
                1,
            )
            .await
            .unwrap();
        assert!(first < second);

        let (_, claim) = claim_head(&mut engine, "runner", 10).await;
        engine
            .defer_optimistic_write(first, claim, 100, "offline".into())
            .await
            .unwrap();
        assert!(
            engine
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 99,
                    lease_expires_at_ms: 200,
                })
                .await
                .unwrap()
                .is_none()
        );
        let data = read_hit(&mut engine, None).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("b"));
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap().len(),
            2
        );
    });
}

#[test]
fn permanent_failure_rolls_back_only_the_claimed_head() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        let (first, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("a"),
                &mutation_response("Status", "a"),
                0,
            )
            .await
            .unwrap();
        engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("b"),
                &mutation_response("Status", "b"),
                1,
            )
            .await
            .unwrap();
        let (_, claim) = claim_head(&mut engine, "runner", 10).await;
        let result = engine
            .rollback_optimistic_write(first, claim)
            .await
            .unwrap();
        // The later layer masks the failed head, so the visible view is stable.
        assert!(result.affected_ops.is_empty());
        let data = read_hit(&mut engine, None).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("b"));
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap().len(),
            1
        );
    });
}

#[test]
fn stale_claim_cannot_settle_mutation() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        let (transaction, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
                0,
            )
            .await
            .unwrap();
        let error = engine
            .rollback_optimistic_write(
                transaction,
                MutationClaimToken {
                    owner: "wrong".into(),
                    generation: 1,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(error, EngineError::StaleMutationClaim(id) if id == transaction));
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap().len(),
            1
        );
    });
}

#[test]
fn clear_and_identity_reset_drop_durable_queue() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &query_vars(),
                &soup_page("Status", "todo"),
                Some("user-1"),
            )
            .await
            .unwrap();
        engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
                0,
            )
            .await
            .unwrap();

        let reset = engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &query_vars(),
                &json!({
                    "user": {
                        "id": "user-2",
                        "soup": { "items": [], "hasMore": false }
                    }
                }),
                Some("user-2"),
            )
            .await
            .unwrap();
        assert!(reset.reset);
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );

        engine.clear().await.unwrap();
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
    });
}
