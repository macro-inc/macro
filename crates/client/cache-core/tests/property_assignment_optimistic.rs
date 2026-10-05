//! First assignments remain linked across enqueue, replay, settlement and rollback.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::link_patch::{
    LinkOperation, LinkPathSegment, OptimisticLinkPatch, QueryRevalidation, RecordRoot,
};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::record_selection::RecordSelection;
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const QUERY: &str = r#"
query Properties($input: SoupInput!) {
  user { id soup(input: $input) { items { __typename id properties {
    id definition: propertyDefinitionId value {
      __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
    }
  } } } }
}"#;
const FRAGMENT: &str = r#"
fragment AssignmentParent on GraphqlSoupEntity {
  __typename id properties { id definition: propertyDefinitionId value {
    __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
  } }
}"#;
const MUTATION: &str = r#"
mutation Set($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id propertyDefinitionId value {
    __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
  } }
}"#;
const UUID: &str = "1697e6bc-0d9a-4dd2-bc3f-bd33bcb6f607";

fn variables() -> serde_json::Map<String, Json> {
    json!({"input":{}}).as_object().unwrap().clone()
}
fn response(id: &str, value: &str) -> Json {
    json!({"setEntityProperty": {"id":id, "propertyDefinitionId":"priority",
        "value":{"__typename":"GraphqlSelectOptionPropertyValue","optionIds":[value]}}})
}
fn patch() -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        record_root: Some(RecordRoot {
            fragment_name: "AssignmentParent".into(),
            entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
        }),
        query: FRAGMENT.into(),
        operation_name: None,
        variables_json: "{}".into(),
        path: vec![LinkPathSegment::Field {
            field: "properties".into(),
        }],
        operation: LinkOperation::UpsertByField {
            entity_key: EntityKey("GraphqlProperty:temporary-1".into()),
            where_field: "definition".into(),
            equals: json!("priority"),
        },
    }
}
async fn seeded() -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    engine
        .write_query(
            None,
            QUERY,
            Some("Properties"),
            &variables(),
            &json!({"user":{
                "id":"user-1", "soup":{"items":[
                    {"__typename":"GraphqlSoupDocument","id":"task-1","properties":[]},
                    {"__typename":"GraphqlSoupDocument","id":"task-2","properties":[]}
                ]}
            }}),
            None,
        )
        .await
        .unwrap();
    engine
}
async fn read(engine: &mut Engine<InMemoryStorage>) -> Json {
    let ReadResult::Hit { data, .. } = engine
        .read_query(Some(1), QUERY, Some("Properties"), &variables())
        .await
        .unwrap()
    else {
        panic!("properties must remain readable");
    };
    data
}
async fn enqueue(engine: &mut Engine<InMemoryStorage>, value: &str, now: i64) -> u64 {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                identity_bindings: &[],
                uuid: UUID,
                query: MUTATION,
                operation_name: Some("Set"),
                variables: &variables(),
                data: &response("temporary-1", value),
                link_patches: &[patch()],
                revalidations: &[],
                created_at_ms: now,
            },
        )
        .await
        .unwrap()
        .0
}
async fn claim(engine: &mut Engine<InMemoryStorage>, now: i64) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: now,
            lease_expires_at_ms: now + 100,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "test".into(),
        generation: claimed.lease_generation,
    }
}
fn properties(data: &Json) -> &Json {
    &data["user"]["soup"]["items"][0]["properties"]
}

#[test]
fn new_assignment_is_visible_before_response_and_reconciles_server_identity() {
    block_on(async {
        let mut engine = seeded().await;
        read(&mut engine).await;
        let txn = enqueue(&mut engine, "urgent", 1).await;
        let data = read(&mut engine).await;
        assert_eq!(
            properties(&data)[0]["value"]["optionIds"],
            json!(["urgent"])
        );
        assert_eq!(data["user"]["soup"]["items"][1]["properties"], json!([]));
        let mut engine = Engine::new(engine.storage().clone());
        assert_eq!(properties(&read(&mut engine).await)[0]["id"], "temporary-1");
        let claim = claim(&mut engine, 2).await;
        engine
            .commit_optimistic_write(
                txn,
                claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "urgent"),
            )
            .await
            .unwrap();
        let data = read(&mut engine).await;
        assert_eq!(properties(&data).as_array().unwrap().len(), 1);
        assert_eq!(properties(&data)[0]["id"], "server-1");
        assert_eq!(
            properties(&data)[0]["value"]["optionIds"],
            json!(["urgent"])
        );
        let mut reopened = Engine::new(engine.storage().clone());
        assert_eq!(read(&mut reopened).await, data);
    });
}

#[test]
fn cold_parent_needs_no_query_root_or_cached_page_for_enqueue_and_replay() {
    block_on(async {
        let engine = seeded().await;
        let mut storage = engine.into_storage();
        storage
            .delete_batch(&[EntityKey::root(), EntityKey("GraphqlUser:user-1".into())])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let txn = enqueue(&mut engine, "urgent", 1).await;
        let mut engine = Engine::new(engine.into_storage());
        let selection = RecordSelection::parse(FRAGMENT, "AssignmentParent").unwrap();
        let key = EntityKey("GraphqlSoupDocument:task-1".into());
        let records = engine
            .read_records_by_keys(&selection, std::slice::from_ref(&key))
            .await
            .unwrap();
        assert_eq!(
            records.value[0].record["properties"][0]["id"],
            "temporary-1"
        );
        let claim = claim(&mut engine, 2).await;
        let committed = engine
            .commit_optimistic_write(
                txn,
                claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "urgent"),
            )
            .await
            .unwrap();
        assert!(
            committed.revalidations.is_empty(),
            "fragments are never network revalidations"
        );
        let records = engine
            .read_records_by_keys(&selection, &[key])
            .await
            .unwrap();
        assert_eq!(records.value[0].record["properties"][0]["id"], "server-1");
    });
}

#[test]
fn pending_assignment_replays_after_its_original_page_is_evicted() {
    block_on(async {
        let mut engine = seeded().await;
        let txn = enqueue(&mut engine, "urgent", 1).await;
        let pending = engine.storage().load_mutation_queue().await.unwrap();
        for n in 0..cache_core::page_retention::MAX_SOUP_PAGES + 1 {
            engine
                .write_query(
                    None,
                    QUERY,
                    Some("Properties"),
                    json!({"input":{"initial":{"limit":n}}})
                        .as_object()
                        .unwrap(),
                    &json!({"user":{"id":"user-1","soup":{"items":[]}}}),
                    None,
                )
                .await
                .unwrap();
        }
        assert!(matches!(
            engine
                .read_query(None, QUERY, Some("Properties"), &variables())
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap(),
            pending
        );
        let mut engine = Engine::new(engine.into_storage());
        let selection = RecordSelection::parse(FRAGMENT, "AssignmentParent").unwrap();
        let keys = [EntityKey("GraphqlSoupDocument:task-1".into())];
        let records = engine
            .read_records_by_keys(&selection, &keys)
            .await
            .unwrap();
        assert_eq!(
            records.value[0].record["properties"][0]["id"],
            "temporary-1"
        );
        let claim = claim(&mut engine, 2).await;
        engine
            .commit_optimistic_write(
                txn,
                claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "urgent"),
            )
            .await
            .unwrap();
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        let records = engine
            .read_records_by_keys(&selection, &keys)
            .await
            .unwrap();
        assert_eq!(records.value[0].record["properties"][0]["id"], "server-1");
    });
}

#[test]
fn failure_removes_the_temporary_link() {
    block_on(async {
        let mut engine = seeded().await;
        let txn = enqueue(&mut engine, "urgent", 1).await;
        let claim = claim(&mut engine, 2).await;
        engine.rollback_optimistic_write(txn, claim).await.unwrap();
        assert_eq!(properties(&read(&mut engine).await), &json!([]));
    });
}

#[test]
fn persisted_recovery_query_runs_only_when_the_assignment_link_cannot_be_repaired() {
    block_on(async {
        for (include_patch, evict_parent) in [(true, false), (false, false), (true, true)] {
            let mut engine = seeded().await;
            let recovery = QueryRevalidation {
                query: QUERY.into(),
                operation_name: Some("Properties".into()),
                variables_json: serde_json::to_string(&variables()).unwrap(),
                only_on_link_failure: true,
            };
            let patches = if include_patch { vec![patch()] } else { vec![] };
            let txn = engine
                .begin_optimistic_write(
                    None,
                    BeginOptimisticWrite {
                        identity_bindings: &[],
                        uuid: UUID,
                        query: MUTATION,
                        operation_name: Some("Set"),
                        variables: &variables(),
                        data: &response("temporary-1", "urgent"),
                        link_patches: &patches,
                        revalidations: std::slice::from_ref(&recovery),
                        created_at_ms: 1,
                    },
                )
                .await
                .unwrap()
                .0;
            let mut storage = engine.into_storage();
            if evict_parent {
                storage
                    .delete_batch(&[EntityKey("GraphqlSoupDocument:task-1".into())])
                    .await
                    .unwrap();
            }
            // Recovery intent survives closing the original tab before commit.
            let mut engine = Engine::new(storage);
            let claim = claim(&mut engine, 2).await;
            let result = engine
                .commit_optimistic_write(
                    txn,
                    claim,
                    MUTATION,
                    Some("Set"),
                    &variables(),
                    &response("server-1", "urgent"),
                )
                .await
                .unwrap();
            if include_patch && !evict_parent {
                assert!(result.revalidations.is_empty());
                assert_eq!(properties(&read(&mut engine).await)[0]["id"], "server-1");
            } else {
                assert_eq!(result.revalidations, vec![recovery]);
            }
        }
    });
}

#[test]
fn later_edit_rebases_over_new_server_id_without_duplicate_properties() {
    block_on(async {
        let mut engine = seeded().await;
        let first = enqueue(&mut engine, "urgent", 1).await;
        let first_claim = claim(&mut engine, 2).await;
        let second = enqueue(&mut engine, "low", 3).await;
        engine
            .commit_optimistic_write(
                first,
                first_claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "urgent"),
            )
            .await
            .unwrap();
        let data = read(&mut engine).await;
        assert_eq!(properties(&data).as_array().unwrap().len(), 1);
        assert_eq!(properties(&data)[0]["value"]["optionIds"], json!(["low"]));
        let second_claim = claim(&mut engine, 4).await;
        engine
            .commit_optimistic_write(
                second,
                second_claim,
                MUTATION,
                Some("Set"),
                &variables(),
                &response("server-1", "low"),
            )
            .await
            .unwrap();
        let data = read(&mut engine).await;
        assert_eq!(properties(&data).as_array().unwrap().len(), 1);
        assert_eq!(properties(&data)[0]["id"], "server-1");
        assert_eq!(properties(&data)[0]["value"]["optionIds"], json!(["low"]));
    });
}
