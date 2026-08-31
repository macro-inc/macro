//! Durable optimistic mutation tests: enqueue/read/claim/retry/commit/fail,
//! strict ordering, and lifecycle resets.

use cache_core::engine::{
    BeginOptimisticWrite, Engine, EngineError, InitialClaimOutcome, ReadResult,
};
use cache_core::predicate::ProjectionMutation;
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, NewQueuedMutation,
    QueuedMutation,
};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use predicate_index::PendingOptimisticProjection;
use serde_json::{Value as Json, json};
use std::sync::atomic::{AtomicBool, Ordering};

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

const PROPERTY_KEY: &str = "GraphqlProperty:prop-1";

#[derive(Debug, Default)]
struct ClaimFailingStorage {
    inner: InMemoryStorage,
    fail_next_claim: bool,
    fail_next_queue_load: AtomicBool,
}

impl ClaimFailingStorage {
    fn new() -> Self {
        Self {
            inner: InMemoryStorage::new(),
            fail_next_claim: true,
            fail_next_queue_load: AtomicBool::new(false),
        }
    }

    fn reconciliation_failing() -> Self {
        Self {
            inner: InMemoryStorage::new(),
            fail_next_claim: false,
            fail_next_queue_load: AtomicBool::new(false),
        }
    }

    fn fail_next_queue_load(&self) {
        self.fail_next_queue_load.store(true, Ordering::Relaxed);
    }
}

impl Storage for ClaimFailingStorage {
    type Error = std::io::Error;

    async fn get_batch(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, Self::Error> {
        Ok(self.inner.get_batch(keys).await.unwrap())
    }

    async fn put_batch(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<(), Self::Error> {
        self.inner.put_batch(entries).await.unwrap();
        Ok(())
    }

    async fn put_batch_with_projections(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), Self::Error> {
        self.inner
            .put_batch_with_projections(entries, projections)
            .await
            .unwrap();
        Ok(())
    }

    async fn delete_batch(&mut self, keys: &[EntityKey<'static>]) -> Result<(), Self::Error> {
        self.inner.delete_batch(keys).await.unwrap();
        Ok(())
    }

    async fn enqueue_mutation_with_shadow(
        &mut self,
        entry: NewQueuedMutation,
        projections: Vec<PendingOptimisticProjection>,
    ) -> Result<MutationId, Self::Error> {
        Ok(self
            .inner
            .enqueue_mutation_with_shadow(entry, projections)
            .await
            .unwrap())
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
        if self.fail_next_queue_load.swap(false, Ordering::Relaxed) {
            return Err(std::io::Error::other(
                "injected reconciliation queue load failure",
            ));
        }
        Ok(self.inner.load_mutation_queue().await.unwrap())
    }

    async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, Self::Error> {
        if std::mem::take(&mut self.fail_next_claim) {
            return Err(std::io::Error::other("injected claim failure"));
        }
        Ok(self.inner.claim_next_mutation(request).await.unwrap())
    }

    async fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<bool, Self::Error> {
        Ok(self
            .inner
            .defer_mutation(id, claim, next_attempt_at_ms, error)
            .await
            .unwrap())
    }

    async fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<bool, Self::Error> {
        Ok(self
            .inner
            .complete_mutation(id, claim, entries)
            .await
            .unwrap())
    }

    async fn complete_mutation_with_projections(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<bool, Self::Error> {
        Ok(self
            .inner
            .complete_mutation_with_projections(id, claim, entries, projections)
            .await
            .unwrap())
    }

    async fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> Result<bool, Self::Error> {
        Ok(self.inner.discard_mutation(id, claim).await.unwrap())
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.inner.clear().await.unwrap();
        Ok(())
    }
}

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
                }],
                "nextCursor": null
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
    &data["user"]["soup"]["items"][0]["properties"][0]
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

async fn reconciliation_engine() -> (Engine<ClaimFailingStorage>, MutationId) {
    let mut engine = Engine::new(ClaimFailingStorage::reconciliation_failing());
    engine
        .write_query(
            None,
            QUERY,
            Some("Soup"),
            &query_vars(),
            &soup_page("Status", "todo"),
            None,
        )
        .await
        .unwrap();
    let (transaction, _) = engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                query: MUTATION,
                operation_name: Some("SetEntityProperty"),
                variables: &mutation_vars("doing"),
                data: &mutation_response("Status", "doing"),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 123,
            },
        )
        .await
        .unwrap();
    (engine, transaction)
}

async fn claim_reconciliation_head(engine: &mut Engine<ClaimFailingStorage>) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 123,
            lease_expires_at_ms: 1_123,
        })
        .await
        .unwrap()
        .expect("queue head");
    MutationClaimToken {
        owner: "runner".into(),
        generation: claimed.lease_generation,
    }
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
        .get_batch(&[EntityKey(PROPERTY_KEY.to_string().into())])
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
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("doing"),
                    data: &mutation_response("Status", "doing"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 123,
                },
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
fn enqueue_claims_new_mutation_when_queue_was_empty() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        let result = engine
            .enqueue_optimistic_mutation(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("doing"),
                    data: &mutation_response("Status", "doing"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 123,
                },
                MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 123,
                    lease_expires_at_ms: 1_123,
                },
            )
            .await
            .unwrap();

        let InitialClaimOutcome::Claimed(claimed) = result.initial_claim else {
            panic!("new strict queue head should be claimed")
        };
        assert_eq!(claimed.queued.id, result.transaction_id);
        assert_eq!(claimed.queued.mutation.attempt_count, 1);
    });
}

#[test]
fn enqueue_claims_older_strict_head() {
    block_on(async {
        let mut engine = engine_with_base("Status", "todo").await;
        let (older, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("older"),
                    data: &mutation_response("Status", "older"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();
        let result = engine
            .enqueue_optimistic_mutation(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("new"),
                    data: &mutation_response("Status", "new"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 2,
                },
                MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 10,
                    lease_expires_at_ms: 1_010,
                },
            )
            .await
            .unwrap();

        assert!(older < result.transaction_id);
        let InitialClaimOutcome::Claimed(claimed) = result.initial_claim else {
            panic!("older strict queue head should be claimed")
        };
        assert_eq!(claimed.queued.id, older);
    });
}

#[test]
fn enqueue_does_not_skip_a_leased_or_deferred_head() {
    block_on(async {
        for deferred in [false, true] {
            let mut engine = engine_with_base("Status", "todo").await;
            let (older, _) = engine
                .begin_optimistic_write(
                    None,
                    BeginOptimisticWrite {
                        query: MUTATION,
                        operation_name: Some("SetEntityProperty"),
                        variables: &mutation_vars("older"),
                        data: &mutation_response("Status", "older"),
                        link_patches: &[],
                        revalidations: &[],
                        created_at_ms: 1,
                    },
                )
                .await
                .unwrap();
            let (_, claim) = claim_head(&mut engine, "first-runner", 10).await;
            if deferred {
                engine
                    .defer_optimistic_write(older, claim, 500, "offline".into())
                    .await
                    .unwrap();
            }

            let result = engine
                .enqueue_optimistic_mutation(
                    None,
                    BeginOptimisticWrite {
                        query: MUTATION,
                        operation_name: Some("SetEntityProperty"),
                        variables: &mutation_vars("new"),
                        data: &mutation_response("Status", "new"),
                        link_patches: &[],
                        revalidations: &[],
                        created_at_ms: 20,
                    },
                    MutationClaimRequest {
                        owner: "second-runner".into(),
                        now_ms: 20,
                        lease_expires_at_ms: 1_020,
                    },
                )
                .await
                .unwrap();

            assert!(matches!(
                result.initial_claim,
                InitialClaimOutcome::NotRunnable
            ));
            assert_eq!(
                engine.storage().load_mutation_queue().await.unwrap().len(),
                2
            );
            let data = read_hit(&mut engine, None).await;
            assert_eq!(property_of(&data)["value"]["stringValue"], json!("new"));
        }
    });
}

#[test]
fn claim_failure_after_enqueue_preserves_one_durable_visible_mutation() {
    block_on(async {
        let compatibility_storage = ClaimFailingStorage::new();
        assert_eq!(
            compatibility_storage.queue_diagnostics().await.unwrap(),
            cache_core::store::QueueDiagnostics::default(),
            "the compatibility default must be explicitly unavailable"
        );
        let mut engine = Engine::new(compatibility_storage);
        engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &query_vars(),
                &soup_page("Status", "todo"),
                None,
            )
            .await
            .unwrap();

        let result = engine
            .enqueue_optimistic_mutation(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("doing"),
                    data: &mutation_response("Status", "doing"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 123,
                },
                MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 123,
                    lease_expires_at_ms: 1_123,
                },
            )
            .await
            .unwrap();

        assert_eq!(
            result.write_result.revision,
            engine.current_revision(),
            "the failed lease claim must not add a second revision"
        );
        assert!(matches!(
            result.initial_claim,
            InitialClaimOutcome::Failed(EngineError::Storage(ref error))
                if error.to_string() == "injected claim failure"
        ));
        let queued = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].id, result.transaction_id);
        assert_eq!(queued[0].mutation.attempt_count, 0);
        let data = match engine
            .read_query(None, QUERY, Some("Soup"), &query_vars())
            .await
            .unwrap()
        {
            ReadResult::Hit { data } => data,
            ReadResult::Miss => panic!("expected optimistic hit"),
        };
        assert_eq!(property_of(&data)["value"]["stringValue"], json!("doing"));
    });
}

#[test]
fn durable_mutations_advance_revision_before_reconciliation() {
    block_on(async {
        let (mut write_engine, _) = reconciliation_engine().await;
        write_engine.storage().fail_next_queue_load();
        let write_result = write_engine
            .write_query(
                None,
                QUERY,
                Some("Soup"),
                &query_vars(),
                &soup_page("Status (server)", "done"),
                None,
            )
            .await;
        assert!(matches!(
            write_result,
            Err(EngineError::Storage(ref error))
                if error.to_string() == "injected reconciliation queue load failure"
        ));
        assert_eq!(write_engine.current_revision().to_string(), "3");

        let (mut commit_engine, transaction) = reconciliation_engine().await;
        let claim = claim_reconciliation_head(&mut commit_engine).await;
        commit_engine.storage().fail_next_queue_load();
        let commit_result = commit_engine
            .commit_optimistic_write(
                transaction,
                claim,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_vars("done"),
                &mutation_response("Status (server)", "done"),
            )
            .await;
        assert!(matches!(
            commit_result,
            Err(EngineError::Storage(ref error))
                if error.to_string() == "injected reconciliation queue load failure"
        ));
        assert_eq!(commit_engine.current_revision().to_string(), "3");

        let (mut rollback_engine, transaction) = reconciliation_engine().await;
        let claim = claim_reconciliation_head(&mut rollback_engine).await;
        rollback_engine.storage().fail_next_queue_load();
        let rollback_result = rollback_engine
            .rollback_optimistic_write(transaction, claim)
            .await;
        assert!(matches!(
            rollback_result,
            Err(EngineError::Storage(ref error))
                if error.to_string() == "injected reconciliation queue load failure"
        ));
        assert_eq!(rollback_engine.current_revision().to_string(), "3");
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
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("doing"),
                    data: &mutation_response("Status", "doing"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
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
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("a"),
                    data: &mutation_response("Status", "a"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();
        let (second, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("b"),
                    data: &mutation_response("Status", "b"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
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
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("a"),
                    data: &mutation_response("Status", "a"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("b"),
                    data: &mutation_response("Status", "b"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
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
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("doing"),
                    data: &mutation_response("Status", "doing"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();
        let revision_before_stale_settlement = engine.current_revision();
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
        assert_eq!(engine.current_revision(), revision_before_stale_settlement);
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
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_vars("doing"),
                    data: &mutation_response("Status", "doing"),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
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
                        "soup": { "items": [], "nextCursor": null }
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
