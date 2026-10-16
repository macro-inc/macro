//! Cancellation fences send authority independently of optimistic content.
use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, Engine, EngineError},
    queue::{MutationClaimRequest, MutationClaimToken},
    store::Storage,
};
use pollster::block_on;
use serde_json::json;

const QUERY: &str = "mutation SetEntityProperty($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { id displayName } }";
const UUID: &str = "00000000-0000-4000-8000-000000000001";

async fn enqueue(engine: &mut Engine<TursoStorage>, uuid: &str, replace: bool, name: &str) -> u64 {
    engine.begin_optimistic_write(None, BeginOptimisticWrite {
            client_metadata: None,
        uuid, query: QUERY, operation_name: Some("SetEntityProperty"),
        variables: &json!({"input": {"entityId": "doc", "value": {"string": name}}}).as_object().unwrap().clone(),
        data: &json!({"setEntityProperty": {"id":"property", "displayName": name}, "__durableIntent": {"kind":"test", "replace": replace, "payload":{"body":"recover me"}}}),
        link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 1,
    }).await.unwrap().0
}

async fn claim(engine: &mut Engine<TursoStorage>) -> MutationClaimToken {
    let claim = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 1,
            lease_expires_at_ms: 1000,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "runner".into(),
        generation: claim.lease_generation,
    }
}

#[test]
fn unattempted_cancel_survives_reopen_without_sending_and_preserves_order() {
    block_on(async {
        let database = TursoMemoryDatabase::new("durable-intent.db");
        let mut engine = Engine::new(database.open("scope").unwrap());
        let send = enqueue(&mut engine, UUID, false, "send").await;
        enqueue(
            &mut engine,
            "00000000-0000-4000-8000-000000000002",
            false,
            "later",
        )
        .await;
        assert_eq!(enqueue(&mut engine, UUID, true, "cancel").await, send);
        let queue = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(queue.len(), 2);
        assert!(queue[0].mutation.request.variables_json.contains("cancel"));
        assert!(
            engine
                .durable_mutation_intents()
                .await
                .unwrap()
                .iter()
                .any(|row| row["uuid"] == UUID && row["locallyCancelled"] == true)
        );
        engine.into_storage().try_close().unwrap();
        let mut reopened = Engine::new(database.open("scope").unwrap());
        let token = claim(&mut reopened).await;
        reopened
            .rollback_optimistic_write(send, token)
            .await
            .unwrap();
        let rows = reopened.durable_mutation_intents().await.unwrap();
        assert_eq!(rows.len(), 2);
        let cancelled = rows.iter().find(|row| row["uuid"] == UUID).unwrap();
        assert_eq!(cancelled["phase"], "failed");
        assert_eq!(cancelled["metadata"]["payload"]["body"], "recover me");
        assert_eq!(cancelled["locallyCancelled"], true);
    });
}

#[test]
fn attempted_send_cannot_settle_after_cancel_and_repeated_cancel_stays_locked() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("durable-intent").unwrap());
        let send = enqueue(&mut engine, UUID, false, "send").await;
        assert!(!engine.retire_mutation_intent(UUID).await.unwrap());
        let original = claim(&mut engine).await;
        enqueue(&mut engine, UUID, true, "cancel").await;
        enqueue(&mut engine, UUID, true, "cancel again").await;
        assert_eq!(
            engine.durable_mutation_intents().await.unwrap()[0]["locallyCancelled"],
            false
        );
        let vars = json!({"input":{}}).as_object().unwrap().clone();
        let stale = engine
            .commit_optimistic_write(
                send,
                original.clone(),
                QUERY,
                Some("SetEntityProperty"),
                &vars,
                &json!({"setEntityProperty":{"id":"property","displayName":"sent"}}),
            )
            .await;
        assert!(matches!(stale, Err(EngineError::StaleMutationClaim(_))));
        assert!(matches!(
            engine.rollback_optimistic_write(send, original).await,
            Err(EngineError::StaleMutationClaim(_))
        ));
        assert_eq!(
            engine.durable_mutation_intents().await.unwrap()[0]["phase"],
            "pending"
        );
        let current = claim(&mut engine).await;
        engine
            .rollback_optimistic_write(send, current)
            .await
            .unwrap();
        let rows = engine.durable_mutation_intents().await.unwrap();
        assert_eq!(rows[0]["phase"], "failed");
        assert_eq!(rows[0]["locallyCancelled"], false);
    });
}

#[test]
fn cancellation_faults_leave_the_original_send_and_recovery_content_together() {
    block_on(async {
        for index in 0..=2 {
            let mut engine = Engine::new(TursoStorage::open_in_memory("cancel-fault").unwrap());
            enqueue(&mut engine, UUID, false, "send").await;
            let mut storage = engine.into_storage();
            let queue = storage.load_mutation_queue().await.unwrap();
            let catalog = storage
                .get_batch(&[cache_core::durable_intent::key()])
                .await
                .unwrap();
            let mut replacement = queued("Cancel");
            replacement.uuid = uuid::Uuid::parse_str(UUID).unwrap();
            let mut source = cache_core::queue::decode_optimistic_source(
                &queue[0].optimistic.optimistic_data_json,
            )
            .unwrap();
            source.mutation_data["__durableIntent"]["replace"] = json!(true);
            replacement.optimistic.optimistic_data_json =
                cache_core::queue::encode_optimistic_source(&source);
            storage.arm_fault(TestFault::After {
                site: TestFaultSite::Enqueue,
                index,
            });
            assert!(storage.enqueue_mutation(replacement).await.is_err());
            assert_eq!(storage.load_mutation_queue().await.unwrap(), queue);
            assert_eq!(
                storage
                    .get_batch(&[cache_core::durable_intent::key()])
                    .await
                    .unwrap(),
                catalog
            );
        }
    });
}

#[test]
fn settling_a_head_cannot_overwrite_a_replaced_tail_with_the_same_id() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("tail-fence").unwrap());
        let first = enqueue(&mut engine, UUID, false, "first").await;
        let tail_uuid = "00000000-0000-4000-8000-000000000002";
        let tail = enqueue(&mut engine, tail_uuid, false, "send").await;
        let token = claim(&mut engine).await;
        let stale = OptimisticShadowReconciliation {
            expected_queue: vec![first, tail],
            expected_tail_generations: vec![(tail, 0)],
            affected_keys: vec![],
            replacements: vec![],
        };
        assert_eq!(enqueue(&mut engine, tail_uuid, true, "cancel").await, tail);
        let mut storage = engine.into_storage();
        assert!(
            !storage
                .complete_mutation_with_shadow(first, token, vec![], vec![], stale)
                .await
                .unwrap()
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 2);
    });
}

#[test]
fn terminal_recovery_can_be_retired_without_erasing_other_intents() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("retirement").unwrap());
        let first = enqueue(&mut engine, UUID, false, "first").await;
        let second_uuid = "00000000-0000-4000-8000-000000000002";
        enqueue(&mut engine, second_uuid, false, "second").await;
        assert!(!engine.retire_mutation_intent(UUID).await.unwrap());
        let token = claim(&mut engine).await;
        engine
            .rollback_optimistic_write(first, token)
            .await
            .unwrap();
        assert!(engine.retire_mutation_intent(UUID).await.unwrap());
        let intents = engine.durable_mutation_intents().await.unwrap();
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0]["uuid"], second_uuid);
    });
}

async fn exclusive_enqueue<S: Storage>(
    engine: &mut Engine<S>,
    uuid: &str,
    entity: &str,
    replace: bool,
) -> Result<u64, EngineError<S::Error>> {
    engine.begin_optimistic_write(None, BeginOptimisticWrite {
            client_metadata: None,
        uuid, query: QUERY, operation_name: Some("SetEntityProperty"),
        variables: &json!({"input": {}}).as_object().unwrap().clone(),
        data: &json!({"setEntityProperty": {"id":"property", "displayName": "send"}, "__durableIntent": {
            "kind":"test", "replace":replace, "exclusive": {
                "entityKey":entity,"releaseOn":{"responsePath":["setEntityProperty","displayName"],"value":"CANCELLED"}
            }
        }}),
        link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 1,
    }).await.map(|result| result.0)
}

#[test]
fn exclusive_send_rejects_another_tab_without_changing_the_winning_snapshot() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("exclusive-send").unwrap());
        exclusive_enqueue(&mut engine, UUID, "GraphqlSoupEmailMessage:draft", false)
            .await
            .unwrap();
        let queue = engine.storage().load_mutation_queue().await.unwrap();
        let journal = engine.durable_mutation_intents().await.unwrap();
        let error = exclusive_enqueue(
            &mut engine,
            "00000000-0000-4000-8000-000000000002",
            "GraphqlSoupEmailMessage:draft",
            false,
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            EngineError::Storage(TursoStorageError::ExclusiveIntentConflict)
        ));
        assert_eq!(engine.storage().load_mutation_queue().await.unwrap(), queue);
        assert_eq!(engine.durable_mutation_intents().await.unwrap(), journal);
        // Cancellation owns the same UUID and releases an unattempted send atomically.
        exclusive_enqueue(&mut engine, UUID, "GraphqlSoupEmailMessage:draft", true)
            .await
            .unwrap();
        exclusive_enqueue(
            &mut engine,
            "00000000-0000-4000-8000-000000000002",
            "GraphqlSoupEmailMessage:draft",
            false,
        )
        .await
        .unwrap();
        let queue = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(queue.len(), 2);
        assert!(
            cache_core::durable_intent::source_metadata(&queue[0].optimistic.optimistic_data_json)
                .unwrap()["replace"]
                .as_bool()
                .unwrap()
        );
    });
}

#[test]
fn exclusive_send_resolves_aliases_and_keeps_ownership_after_failure() {
    block_on(async {
        let mut engine = Engine::new(TursoStorage::open_in_memory("exclusive-send").unwrap());
        let send = exclusive_enqueue(&mut engine, UUID, "GraphqlSoupEmailMessage:local", false)
            .await
            .unwrap();
        let token = claim(&mut engine).await;
        engine.rollback_optimistic_write(send, token).await.unwrap();
        let mut storage = engine.into_storage();
        let canonical =
            cache_core::value::EntityKey::entity("GraphqlSoupEmailMessage", &["server"]);
        storage
            .put_batch(vec![(
                cache_core::value::EntityKey::entity("GraphqlSoupEmailMessage", &["local"]),
                cache_core::identity::alias_record(&canonical),
            )])
            .await
            .unwrap();
        let mut reopened = Engine::new(storage);
        assert!(
            exclusive_enqueue(
                &mut reopened,
                "00000000-0000-4000-8000-000000000002",
                canonical.as_ref(),
                false
            )
            .await
            .is_err()
        );
        assert_eq!(reopened.durable_mutation_intents().await.unwrap().len(), 1);
    });
}

#[test]
fn exclusive_attempted_cancellation_releases_only_after_confirmed_cancel() {
    block_on(async {
        for status in [
            "ACCEPTED",
            "SENDING",
            "SENT",
            "FAILED",
            "DELIVERY_UNCONFIRMED",
            "CANCELLED",
        ] {
            let mut engine = Engine::new(TursoStorage::open_in_memory("exclusive-send").unwrap());
            let send = exclusive_enqueue(&mut engine, UUID, "GraphqlSoupEmailMessage:draft", false)
                .await
                .unwrap();
            claim(&mut engine).await;
            exclusive_enqueue(&mut engine, UUID, "GraphqlSoupEmailMessage:draft", true)
                .await
                .unwrap();
            let token = claim(&mut engine).await;
            engine
                .commit_optimistic_write(
                    send,
                    token,
                    QUERY,
                    Some("SetEntityProperty"),
                    &json!({"input":{}}).as_object().unwrap().clone(),
                    &json!({"setEntityProperty":{"id":"property","displayName":status}}),
                )
                .await
                .unwrap();
            let result = exclusive_enqueue(
                &mut engine,
                "00000000-0000-4000-8000-000000000002",
                "GraphqlSoupEmailMessage:draft",
                false,
            )
            .await;
            assert_eq!(result.is_ok(), status == "CANCELLED", "status {status}");
        }
    });
}
