//! Cancellation fences send authority independently of optimistic content.
use cache_core::{
    engine::{BeginOptimisticWrite, Engine, EngineError},
    queue::{MutationClaimRequest, MutationClaimToken},
    store::{InMemoryStorage, Storage},
};
use pollster::block_on;
use serde_json::json;

const QUERY: &str = "mutation SetEntityProperty($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { id displayName } }";
const UUID: &str = "00000000-0000-4000-8000-000000000001";

async fn enqueue(
    engine: &mut Engine<InMemoryStorage>,
    uuid: &str,
    replace: bool,
    name: &str,
) -> u64 {
    engine.begin_optimistic_write(None, BeginOptimisticWrite {
            client_metadata: None,
        uuid, query: QUERY, operation_name: Some("SetEntityProperty"),
        variables: &json!({"input": {"entityId": "doc", "value": {"string": name}}}).as_object().unwrap().clone(),
        data: &json!({"setEntityProperty": {"id":"property", "displayName": name}, "__durableIntent": {"kind":"test", "replace": replace, "payload":{"body":"recover me"}}}),
        link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 1,
    }).await.unwrap().0
}

async fn claim(engine: &mut Engine<InMemoryStorage>) -> MutationClaimToken {
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
        let mut engine = Engine::new(InMemoryStorage::new());
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
        let mut reopened = Engine::new(engine.into_storage());
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
        let mut engine = Engine::new(InMemoryStorage::new());
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
fn offline_admission_does_not_claim_or_attempt_the_send() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let result = engine.enqueue_optimistic_mutation(None,BeginOptimisticWrite {
            client_metadata: None,
            uuid:UUID,query:QUERY,operation_name:Some("SetEntityProperty"),variables:&json!({"input":{}}).as_object().unwrap().clone(),
            data:&json!({"setEntityProperty":{"id":"property","displayName":"send"},"__durableIntent":{"kind":"test","deferInitialClaim":true}}),
            link_patches:&[],revalidations:&[],identity_bindings:&[],created_at_ms:1,
        },MutationClaimRequest{owner:"runner".into(),now_ms:1,lease_expires_at_ms:1000}).await.unwrap();
        assert!(matches!(
            result.initial_claim,
            cache_core::engine::InitialClaimOutcome::NotRunnable
        ));
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap()[0]
                .mutation
                .attempt_count,
            0
        );
        enqueue(&mut engine, UUID, true, "cancel").await;
        assert_eq!(
            engine.durable_mutation_intents().await.unwrap()[0]["locallyCancelled"],
            true
        );
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
        let mut engine = Engine::new(InMemoryStorage::new());
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
            EngineError::Storage(cache_core::durable_intent::DurableIntentError::ExclusiveConflict)
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
        let mut engine = Engine::new(InMemoryStorage::new());
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
            let mut engine = Engine::new(InMemoryStorage::new());
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
