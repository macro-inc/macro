//! Exercise transaction faults through the engine, including live subscribers.

use super::*;
use cache_core::engine::watch_query::QueryUpdate;
use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use serde_json::{Map, Value as Json, json};

const QUERY: &str = "query Page { user { id soup(input: { initial: { limit: 4 } }) { items { __typename id ... on GraphqlSoupDocument { name properties { id displayName } } } nextCursor } } }";
const MUTATION: &str = "mutation Edit { setEntityProperty(input: {}) { id displayName } }";

fn page(viewer: &str, name: &str) -> Json {
    json!({"user":{"id":viewer,"soup":{"items":[{
        "__typename":"GraphqlSoupDocument","id":"doc","name":name,
        "properties":[{"id":"property","displayName":"base"}]
    }],"nextCursor":null}}})
}

async fn edit(engine: &mut Engine<TursoStorage>, uuid: u128, value: &str) -> MutationId {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: &uuid::Uuid::from_u128(uuid).to_string(),
                query: MUTATION,
                operation_name: None,
                variables: &Map::new(),
                data: &json!({"setEntityProperty":{"id":"property","displayName":value}}),
                identity_bindings: &[],
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
            },
        )
        .await
        .unwrap()
        .0
}

async fn snapshot(engine: &mut Engine<TursoStorage>) -> Json {
    let ReadResult::Hit { data } = engine
        .read_query(None, QUERY, None, &Map::new())
        .await
        .unwrap()
    else {
        panic!("expected a complete query")
    };
    data
}

#[derive(Clone, Copy, Debug)]
enum Operation {
    Enqueue,
    Commit,
    Rollback,
    Refresh,
    Clear,
    SwitchIdentity,
}

async fn apply(
    engine: &mut Engine<TursoStorage>,
    op: Operation,
    id: MutationId,
    claim: MutationClaimToken,
) -> Result<(), cache_core::engine::EngineError<TursoStorageError>> {
    match op {
        Operation::Enqueue => {
            engine.begin_optimistic_write(None, BeginOptimisticWrite {
                client_metadata: None,
                uuid: &uuid::Uuid::from_u128(1).to_string(), query: MUTATION,
                operation_name: None, variables: &Map::new(),
                data: &json!({"setEntityProperty":{"id":"property","displayName":"replacement"}}),
                identity_bindings: &[], link_patches: &[], revalidations: &[], created_at_ms: 1,
            }).await?;
        }
        Operation::Commit => {
            engine
                .commit_optimistic_write(
                    id,
                    claim,
                    MUTATION,
                    None,
                    &Map::new(),
                    &json!({"setEntityProperty":{"id":"property","displayName":"canonical"}}),
                )
                .await?;
        }
        Operation::Rollback => {
            engine.rollback_optimistic_write(id, claim).await?;
        }
        Operation::Refresh => {
            engine
                .write_query(
                    None,
                    QUERY,
                    None,
                    &Map::new(),
                    &page("viewer", "refreshed"),
                    None,
                )
                .await?;
        }
        Operation::Clear => {
            engine.clear().await?;
        }
        Operation::SwitchIdentity => {
            engine
                .write_query(
                    None,
                    QUERY,
                    None,
                    &Map::new(),
                    &page("other", "other account"),
                    Some("other"),
                )
                .await?;
        }
    }
    Ok(())
}

#[test]
fn every_statement_failure_preserves_the_queue_and_live_view_until_retry() {
    block_on(async {
        for (op, site, minimum_faults) in [
            (Operation::Enqueue, TestFaultSite::Enqueue, 3),
            (Operation::Commit, TestFaultSite::Complete, 2),
            (Operation::Rollback, TestFaultSite::Discard, 1),
            (Operation::Refresh, TestFaultSite::Put, 1),
            (Operation::Clear, TestFaultSite::Clear, 3),
            (Operation::SwitchIdentity, TestFaultSite::Clear, 3),
            (Operation::SwitchIdentity, TestFaultSite::Put, 4),
        ] {
            let mut reached_success = false;
            // Stop at the first checkpoint beyond this transaction's writes.
            // Each earlier checkpoint must fail atomically, including after DELETE.
            for index in 0..16 {
                let directory = tempfile::tempdir().unwrap();
                let database =
                    TursoFileDatabase::new(directory.path().join("atomic.turso")).unwrap();
                let mut engine = Engine::with_capacity(database.open("atomic").unwrap(), 1);
                engine
                    .write_query(
                        None,
                        QUERY,
                        None,
                        &Map::new(),
                        &page("viewer", "before"),
                        Some("viewer"),
                    )
                    .await
                    .unwrap();
                let id = edit(&mut engine, 1, "first").await;
                edit(&mut engine, 2, "later").await;
                let claimed = engine
                    .claim_next_mutation(MutationClaimRequest {
                        owner: "runner".into(),
                        now_ms: 1,
                        lease_expires_at_ms: 100,
                    })
                    .await
                    .unwrap()
                    .unwrap();
                let claim = token("runner", claimed.lease_generation);
                let before = snapshot(&mut engine).await;
                let revision = engine.current_revision();
                let queue = engine.storage().load_mutation_queue().await.unwrap();
                engine
                    .watch_query(1, QUERY, None, &Map::new(), &[], None)
                    .await
                    .unwrap();
                engine.storage().arm_fault(TestFault::After { site, index });
                let result = apply(&mut engine, op, id, claim.clone()).await;
                if result.is_ok() {
                    assert!(
                        index >= minimum_faults,
                        "{op:?} skipped transaction checkpoints"
                    );
                    reached_success = true;
                    break;
                }
                assert_eq!(engine.current_revision(), revision, "{op:?}/{index}");
                assert_eq!(engine.storage().load_mutation_queue().await.unwrap(), queue);
                assert_eq!(
                    engine.current_identity().await.unwrap().as_deref(),
                    Some("viewer")
                );
                assert_eq!(snapshot(&mut engine).await, before);
                match engine
                    .watch_query(1, QUERY, None, &Map::new(), &[], Some(revision))
                    .await
                    .unwrap()
                {
                    QueryUpdate::Hit { data, .. } => assert_eq!(data, before),
                    QueryUpdate::Patch { patches, .. } => assert!(patches.is_empty()),
                    QueryUpdate::Miss { .. } => panic!("failed write lost the watched query"),
                }
                assert_eq!(
                    engine.into_storage().try_close().unwrap(),
                    TursoStorageCloseOutcome::Healthy
                );
                let mut reopened = Engine::with_capacity(database.open("atomic").unwrap(), 1);
                assert_eq!(snapshot(&mut reopened).await, before);
                assert_eq!(
                    reopened.storage().load_mutation_queue().await.unwrap(),
                    queue
                );
                apply(&mut reopened, op, id, claim).await.unwrap();
                if matches!(op, Operation::SwitchIdentity) {
                    assert_eq!(
                        reopened.current_identity().await.unwrap().as_deref(),
                        Some("other")
                    );
                    assert_eq!(
                        snapshot(&mut reopened).await,
                        page("other", "other account")
                    );
                    assert!(
                        reopened
                            .storage()
                            .load_mutation_queue()
                            .await
                            .unwrap()
                            .is_empty()
                    );
                }
                assert_eq!(
                    reopened.into_storage().try_close().unwrap(),
                    TursoStorageCloseOutcome::Healthy
                );
            }
            assert!(reached_success, "{op:?} exceeded the checkpoint bound");
        }
    });
}
