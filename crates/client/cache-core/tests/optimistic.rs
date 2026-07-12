//! Optimistic mutation layer tests: begin/read/commit/rollback, out-of-order
//! settlement, layer composition, durable isolation, and lifecycle resets.

use cache_core::engine::{Engine, EngineError, ReadResult};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
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

/// Reads the property object out of a soup query hit.
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

/// The durable (storage) value of the property record's displayName, read
/// directly from the underlying store — bypassing optimistic layers.
async fn durable_display_name(engine: &Engine<InMemoryStorage>) -> Option<String> {
    use cache_core::store::Storage;
    use cache_core::value::CacheValue;
    let records = engine
        .storage()
        .get_batch(&[EntityKey(PROPERTY_KEY.to_string())])
        .await
        .unwrap();
    records
        .into_iter()
        .next()
        .flatten()
        .and_then(|record| match record.fields.get("displayName") {
            Some(CacheValue::String(s)) => Some(s.clone()),
            _ => None,
        })
}

#[test]
fn network_mutation_without_layer_writes_through() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        // Register op 1 on the soup query.
        read_hit(&mut engine, Some(1)).await;

        // A plain (non-optimistic) mutation response normalizes into the
        // same records and notifies dependents.
        let write = engine
            .write_query(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("done"),
                &mutation_response("Status", "done"),
                None,
            )
            .await
            .unwrap();
        assert!(write.changed.contains(&EntityKey(PROPERTY_KEY.to_string())));
        assert!(write.affected_ops.contains(&1));
        // Mutation root fields are transient: nothing lands on ROOT_QUERY.
        assert!(!write.changed.iter().any(|k| k.is_root()));

        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("done"));
        assert_eq!(
            durable_display_name(&engine).await.as_deref(),
            Some("Status")
        );
    });
}

#[test]
fn reads_reject_mutation_documents() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let err = engine
            .read_query(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("x"),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, EngineError::Document(_)));
    });
}

#[test]
fn begin_composes_over_base_without_persisting() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        let (txn, begin) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
            )
            .await
            .unwrap();
        assert!(txn > 0);
        assert!(begin.changed.contains(&EntityKey(PROPERTY_KEY.to_string())));
        assert!(begin.affected_ops.contains(&1));
        assert!(!begin.reset);

        // Reads see the optimistic value; durable state is untouched.
        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("doing"));
        use cache_core::store::Storage;
        use cache_core::value::CacheValue;
        let stored = engine
            .storage()
            .get_batch(&[EntityKey(PROPERTY_KEY.to_string())])
            .await
            .unwrap();
        let stored = stored.into_iter().next().flatten().unwrap();
        let Some(CacheValue::Object(value)) = stored.fields.get("value") else {
            panic!("stored value shape");
        };
        assert_eq!(value.get("value"), Some(&CacheValue::String("todo".into())));
    });
}

#[test]
fn begin_with_identical_data_notifies_nobody() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        // Optimistic response identical to the cached data → the effective
        // view is unchanged, nobody re-executes.
        let (_, begin) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("todo"),
                &mutation_response("Status", "todo"),
            )
            .await
            .unwrap();
        assert!(begin.changed.is_empty());
        assert!(begin.affected_ops.is_empty());
    });
}

#[test]
fn commit_replaces_layer_and_flushes_durably() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        let (txn, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
            )
            .await
            .unwrap();

        // The network result differs from the optimistic response.
        let commit = engine
            .commit_optimistic_write(
                txn,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status (renamed)", "doing"),
            )
            .await
            .unwrap();
        // Durable flush happened (single layer = contiguous prefix).
        assert!(
            commit
                .changed
                .contains(&EntityKey(PROPERTY_KEY.to_string()))
        );
        // displayName's visible value changed with the real response.
        assert!(commit.affected_ops.contains(&1));

        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["displayName"], json!("Status (renamed)"));
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("doing"));
        assert_eq!(
            durable_display_name(&engine).await.as_deref(),
            Some("Status (renamed)")
        );

        // Settled transactions are gone: settling again is an error.
        assert!(matches!(
            engine.rollback_optimistic_write(txn).await,
            Err(EngineError::UnknownTransaction(_))
        ));
    });
}

#[test]
fn commit_matching_optimistic_response_is_silent() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        let (txn, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
            )
            .await
            .unwrap();
        let commit = engine
            .commit_optimistic_write(
                txn,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
            )
            .await
            .unwrap();
        // Visible data did not change (real == optimistic) → no local
        // notifications; durable keys still broadcast for other instances.
        assert!(commit.affected_ops.is_empty());
        assert!(
            commit
                .changed
                .contains(&EntityKey(PROPERTY_KEY.to_string()))
        );
    });
}

#[test]
fn rollback_restores_base_view() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        let (txn, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
            )
            .await
            .unwrap();
        let rollback = engine.rollback_optimistic_write(txn).await.unwrap();
        assert!(rollback.affected_ops.contains(&1));
        // Nothing was ever durable, nothing flushed.
        assert!(rollback.changed.is_empty());

        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("todo"));
        assert_eq!(
            durable_display_name(&engine).await.as_deref(),
            Some("Status")
        );
    });
}

#[test]
fn out_of_order_settlement_preserves_later_layer() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        // A then B target the same field.
        let (txn_a, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("a"),
                &mutation_response("Status", "a"),
            )
            .await
            .unwrap();
        let (txn_b, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("b"),
                &mutation_response("Status", "b"),
            )
            .await
            .unwrap();
        assert_ne!(txn_a, txn_b);

        // B settles first: nothing flushes (A still pending ahead of it),
        // and B's real value stays visible over A's pending layer.
        let commit_b = engine
            .commit_optimistic_write(
                txn_b,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("b"),
                &mutation_response("Status", "b!"),
            )
            .await
            .unwrap();
        assert!(commit_b.changed.is_empty(), "no durable flush yet");
        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("b!"));
        assert_eq!(
            durable_display_name(&engine).await.as_deref(),
            Some("Status")
        );

        // A settles second: settling the earlier layer must not clobber the
        // later one. The visible value stays B's; the flush persists both in
        // order (B's response wins the shared field).
        let commit_a = engine
            .commit_optimistic_write(
                txn_a,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("a"),
                &mutation_response("Status", "a!"),
            )
            .await
            .unwrap();
        assert!(commit_a.affected_ops.is_empty(), "visible data unchanged");
        assert!(
            commit_a
                .changed
                .contains(&EntityKey(PROPERTY_KEY.to_string()))
        );

        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("b!"));
    });
}

#[test]
fn rollback_of_earlier_layer_keeps_later_success() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        let (txn_a, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("a"),
                &mutation_response("Status", "a"),
            )
            .await
            .unwrap();
        let (txn_b, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("b"),
                &mutation_response("Status", "b"),
            )
            .await
            .unwrap();

        // B succeeds first; A then fails. The failed tombstone unblocks the
        // prefix and B's real response is what persists.
        engine
            .commit_optimistic_write(
                txn_b,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("b"),
                &mutation_response("Status", "b!"),
            )
            .await
            .unwrap();
        let rollback = engine.rollback_optimistic_write(txn_a).await.unwrap();
        // A's contribution was masked by B → visible data unchanged.
        assert!(rollback.affected_ops.is_empty());
        // The flush persisted B's committed layer.
        assert!(
            rollback
                .changed
                .contains(&EntityKey(PROPERTY_KEY.to_string()))
        );

        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("b!"));
    });
}

#[test]
fn different_fields_on_same_record_compose() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        read_hit(&mut engine, Some(1)).await;

        // Layer A renames; layer B (pending) changes the value.
        let (txn_a, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("todo"),
                &mutation_response("Stage", "todo"),
            )
            .await
            .unwrap();
        let (_txn_b, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Stage", "doing"),
            )
            .await
            .unwrap();

        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["displayName"], json!("Stage"));
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("doing"));

        // A commits while B remains pending: B's pending layer stays
        // visible over the committed base.
        engine
            .commit_optimistic_write(
                txn_a,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("todo"),
                &mutation_response("Stage", "todo"),
            )
            .await
            .unwrap();
        let data = read_hit(&mut engine, Some(1)).await;
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("doing"));
        assert_eq!(
            durable_display_name(&engine).await.as_deref(),
            Some("Stage")
        );
    });
}

#[test]
fn unknown_transaction_ids_error() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        assert!(matches!(
            engine.rollback_optimistic_write(42).await,
            Err(EngineError::UnknownTransaction(42))
        ));
        assert!(matches!(
            engine
                .commit_optimistic_write(
                    7,
                    MUTATION,
                    Some("SetEntityProperty"),
                    &mutation_vars("x"),
                    &mutation_response("Status", "x"),
                )
                .await,
            Err(EngineError::UnknownTransaction(7))
        ));
    });
}

#[test]
fn clear_discards_pending_layers() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        let (txn, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
            )
            .await
            .unwrap();

        engine.clear().await.unwrap();
        let read = engine
            .read_query(None, QUERY, Some("Soup"), &query_vars())
            .await
            .unwrap();
        assert!(matches!(read, ReadResult::Miss));
        // The layer is gone; settling it later is an error, never a write.
        assert!(matches!(
            engine.rollback_optimistic_write(txn).await,
            Err(EngineError::UnknownTransaction(_))
        ));
    });
}

#[test]
fn identity_reset_discards_pending_layers() {
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

        let (txn, _) = engine
            .begin_optimistic_write(
                None,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("doing"),
                &mutation_response("Status", "doing"),
            )
            .await
            .unwrap();

        // A response for another user silently wipes the cache — including
        // the pending optimistic layer.
        let write = engine
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
        assert!(write.reset);
        assert!(matches!(
            engine
                .commit_optimistic_write(
                    txn,
                    MUTATION,
                    Some("SetEntityProperty"),
                    &mutation_vars("doing"),
                    &mutation_response("Status", "doing"),
                )
                .await,
            Err(EngineError::UnknownTransaction(_))
        ));
    });
}
