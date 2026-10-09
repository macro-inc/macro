//! Settlement deltas describe the composed view, including overlapping edits.
use cache_core::engine::{BeginOptimisticWrite, Engine, WriteResult};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Map, Value, json};

const MUTATION: &str = "mutation Read($input: MarkEmailThreadSeenInput!) { markEmailThreadSeen(input: $input) { __typename id isRead } }";
fn variables() -> Map<String, Value> {
    json!({"input":{"threadId":"17"}})
        .as_object()
        .unwrap()
        .clone()
}
fn response(read: bool) -> Value {
    json!({"markEmailThreadSeen":{"__typename":"GraphqlSoupEmailThread","id":"17","isRead":read}})
}
fn fields(result: WriteResult) -> Value {
    serde_json::to_value(result.field_changes.unwrap()).unwrap()
}
fn expected(read: bool) -> Value {
    json!([{"kind":"fields","key":"GraphqlSoupEmailThread:17","fields":{"isRead":read}}])
}

async fn begin(engine: &mut Engine<InMemoryStorage>, uuid: &str, read: bool) -> (u64, WriteResult) {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid,
                query: MUTATION,
                operation_name: None,
                variables: &variables(),
                data: &response(read),
                link_patches: &[],
                revalidations: &[],
                identity_bindings: &[],
                created_at_ms: 0,
            },
        )
        .await
        .unwrap()
}
async fn claim(engine: &mut Engine<InMemoryStorage>) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 100,
            lease_expires_at_ms: 1000,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "test".into(),
        generation: claimed.lease_generation,
    }
}

#[test]
fn commit_and_rollback_keep_later_edits_visible() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, MUTATION, None, &variables(), &response(false), None)
            .await
            .unwrap();
        let (a, write) = begin(&mut engine, "00000000-0000-4000-8000-000000000001", true).await;
        assert_eq!(fields(write), expected(true));
        let (b, write) = begin(&mut engine, "00000000-0000-4000-8000-000000000002", false).await;
        assert_eq!(fields(write), expected(false));
        let token = claim(&mut engine).await;
        let committed = engine
            .commit_optimistic_write(a, token, MUTATION, None, &variables(), &response(true))
            .await
            .unwrap();
        assert_eq!(fields(committed), json!([]));
        let token = claim(&mut engine).await;
        let rolled_back = engine.rollback_optimistic_write(b, token).await.unwrap();
        assert_eq!(fields(rolled_back), expected(true));
    });
}

#[test]
fn rolling_back_an_earlier_edit_does_not_restore_a_whole_snapshot() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, MUTATION, None, &variables(), &response(false), None)
            .await
            .unwrap();
        let (a, _) = begin(&mut engine, "00000000-0000-4000-8000-000000000001", true).await;
        let (b, _) = begin(&mut engine, "00000000-0000-4000-8000-000000000002", true).await;
        let token = claim(&mut engine).await;
        assert_eq!(
            fields(engine.rollback_optimistic_write(a, token).await.unwrap()),
            json!([])
        );
        let token = claim(&mut engine).await;
        assert_eq!(
            fields(engine.rollback_optimistic_write(b, token).await.unwrap()),
            expected(false)
        );
    });
}
