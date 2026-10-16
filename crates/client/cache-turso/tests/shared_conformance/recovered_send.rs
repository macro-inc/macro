use super::*;
use cache_core::engine::{BeginOptimisticWrite, Engine};
use serde_json::json;

async fn enqueue<S: Storage>(engine: &mut Engine<S>, recovered: bool, replace: bool) {
    let variables = json!({"input": {"entityId": "doc", "value": {"string": "body"}}});
    engine
        .begin_optimistic_write(None, BeginOptimisticWrite {
            client_metadata: None,
            uuid: "00000000-0000-4000-8000-000000000001",
            query: "mutation SetEntityProperty($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { id displayName } }",
            operation_name: Some("SetEntityProperty"),
            variables: variables.as_object().unwrap(),
            data: &json!({
                "setEntityProperty": {"id": "property", "displayName": "body"},
                "__durableIntent": {
                    "kind": "test", "payload": {}, "replace": replace,
                    "requiresServerConfirmation": recovered,
                    "exclusive": {
                        "entityKey": "GraphqlSoupEmailMessage:draft",
                        "releaseOn": {"responsePath": ["setEntityProperty", "displayName"], "value": "CANCELLED"}
                    }
                }
            }),
            link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 1,
        })
        .await.unwrap();
}

fn recovered_cancellation<F: BackendFactory>() {
    block_on(async {
        let (mut factory, storage) = F::create();
        let mut engine = Engine::new(storage);
        enqueue(&mut engine, false, false).await;
        engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "original".into(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap()[0]
                .mutation
                .attempt_count,
            1
        );

        // Recovery loses the queue history while its HTTP request may still exist.
        engine.clear().await.unwrap();
        enqueue(&mut engine, true, false).await;
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap()[0]
                .mutation
                .attempt_count,
            0
        );
        let mut engine = Engine::new(factory.reopen(engine.into_storage()));
        enqueue(&mut engine, true, true).await;
        enqueue(&mut engine, true, true).await;
        let intents = engine.durable_mutation_intents().await.unwrap();
        assert_eq!(intents[0]["locallyCancelled"], false);
        assert!(
            !engine
                .retire_mutation_intent("00000000-0000-4000-8000-000000000001")
                .await
                .unwrap()
        );

        let claimed = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "cancel".into(),
                now_ms: 2,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .commit_optimistic_write(
                claimed.queued.id,
                MutationClaimToken {
                    owner: "cancel".into(),
                    generation: claimed.lease_generation,
                },
                &claimed.queued.mutation.request.query,
                Some("SetEntityProperty"),
                json!({"input": {"entityId": "doc", "value": {"string": "body"}}})
                    .as_object()
                    .unwrap(),
                &json!({"setEntityProperty": {"id": "property", "displayName": "CANCELLED"}}),
            )
            .await
            .unwrap();
        assert!(
            engine
                .retire_mutation_intent("00000000-0000-4000-8000-000000000001")
                .await
                .unwrap()
        );
        factory.finish(engine.into_storage());
    });
}

#[test]
fn recovered_send_requires_server_cancellation_in_memory() {
    recovered_cancellation::<InMemoryFactory>();
}

#[test]
fn recovered_send_requires_server_cancellation_in_turso() {
    recovered_cancellation::<TursoFactory>();
}

fn offline_claim_policy<F: BackendFactory>() {
    use cache_core::queue::MutationClaimPolicy;
    block_on(async {
        let (factory, mut storage) = F::create();
        let ordinary = storage.enqueue_mutation(queued("Ordinary")).await.unwrap();
        let mut send = queued("DurableSend");
        send.optimistic.optimistic_data_json =
            json!({"__durableIntent": {"kind": "test", "payload": {}}}).to_string();
        let durable = storage.enqueue_mutation(send).await.unwrap();
        storage
            .enqueue_mutation(queued("LaterOrdinary"))
            .await
            .unwrap();
        let claimed = storage
            .claim_next_mutation_with_policy(
                claim_request("offline", 1, 100),
                MutationClaimPolicy::NonDurable,
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.queued.id, ordinary);
        storage
            .complete_mutation(
                ordinary,
                token("offline", claimed.lease_generation),
                Vec::new(),
            )
            .await
            .unwrap();
        // A different runner may have removed the ordinary head immediately
        // before this claim. The durable head must still remain unattempted.
        assert!(
            storage
                .claim_next_mutation_with_policy(
                    claim_request("offline", 2, 100),
                    MutationClaimPolicy::NonDurable,
                )
                .await
                .unwrap()
                .is_none()
        );
        let queue = storage.load_mutation_queue().await.unwrap();
        assert_eq!(queue[0].id, durable);
        assert_eq!(queue[0].mutation.attempt_count, 0);
        assert!(queue[0].mutation.lease_owner.is_none());
        assert_eq!(queue[1].mutation.attempt_count, 0);
        let claimed = storage
            .claim_next_mutation(claim_request("online", 3, 100))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.queued.id, durable);
        factory.finish(storage);
    });
}

#[test]
fn offline_claim_leaves_durable_head_unattempted_in_memory() {
    offline_claim_policy::<InMemoryFactory>();
}

#[test]
fn offline_claim_leaves_durable_head_unattempted_in_turso() {
    offline_claim_policy::<TursoFactory>();
}
