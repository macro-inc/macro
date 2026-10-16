#![cfg(not(target_arch = "wasm32"))]

#[path = "shared_conformance/calendar_points.rs"]
mod calendar_points;

use cache_core::calendar::{
    CalendarCommit, CalendarFreshness, CalendarLinkWatermark, CalendarRangeRequest,
    CalendarRangeStorage, CalendarReplacedEvent, CalendarSpan, CalendarSpanKind, CalendarSyncState,
    CalendarWatermarkUpdate,
};
use cache_core::normalize::RecordUpdates;
use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::search::{SearchProfile, project_search_documents};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoMemoryDatabase, TursoStorage, TursoStorageCloseOutcome};
use pollster::block_on;

trait BackendFactory: Sized {
    type Backend: CalendarRangeStorage;

    fn create() -> (Self, Self::Backend);
    fn reopen(&mut self, storage: Self::Backend) -> Self::Backend;
    fn finish(self, storage: Self::Backend);
}

struct InMemoryFactory;

impl BackendFactory for InMemoryFactory {
    type Backend = InMemoryStorage;

    fn create() -> (Self, Self::Backend) {
        (Self, InMemoryStorage::new())
    }

    fn reopen(&mut self, storage: Self::Backend) -> Self::Backend {
        storage
    }

    fn finish(self, _: Self::Backend) {}
}

struct TursoFactory {
    database: TursoMemoryDatabase,
}

impl BackendFactory for TursoFactory {
    type Backend = TursoStorage;

    fn create() -> (Self, Self::Backend) {
        // Turso tracks open databases by path, even with separate MemoryIO
        // instances. Concurrent contracts must own distinct physical names.
        let database =
            TursoMemoryDatabase::new(format!("shared-conformance-{}.db", uuid::Uuid::now_v7()));
        let storage = database.open("shared-conformance").unwrap();
        (Self { database }, storage)
    }

    fn reopen(&mut self, storage: Self::Backend) -> Self::Backend {
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
        self.database.open("shared-conformance").unwrap()
    }

    fn finish(self, storage: Self::Backend) {
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    }
}

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn record(value: &str) -> Record {
    let mut record = Record::default();
    record
        .fields
        .insert("value".into(), CacheValue::String(value.into()));
    record
}

fn queued(label: &str) -> NewQueuedMutation {
    NewQueuedMutation {
        uuid: uuid::Uuid::new_v4(),
        mutation: StoredMutation::new(
            MutationRequest {
                query: format!("mutation {label} {{ update {{ id }} }}"),
                operation_name: Some(label.into()),
                variables_json: "{}".into(),
                identity: None,
            },
            1,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: "{}".into(),
            normalized_updates: RecordUpdates::default(),
        },
    }
}

fn fully_populated_queued() -> NewQueuedMutation {
    NewQueuedMutation {
        uuid: uuid::Uuid::new_v4(),
        mutation: StoredMutation {
            request: MutationRequest {
                query: "mutation Full($id: ID!) { update(id: $id) { id } }".into(),
                operation_name: Some("Full".into()),
                variables_json: r#"{"id":"full"}"#.into(),
                identity: Some("identity-witness".into()),
            },
            attempt_count: 7,
            server_failure_count: 3,
            next_attempt_at_ms: Some(-2),
            lease_owner: Some("expired-owner".into()),
            lease_generation: 11,
            lease_expires_at_ms: Some(-1),
            last_error: Some("previous retry".into()),
            created_at_ms: -3,
        },
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: r#"{"update":{"id":"full"}}"#.into(),
            normalized_updates: RecordUpdates::from([(
                key("Optimistic:full"),
                record("optimistic-full"),
            )]),
        },
    }
}

fn token(owner: &str, generation: u64) -> MutationClaimToken {
    MutationClaimToken {
        owner: owner.into(),
        generation,
    }
}

fn claim_request(owner: &str, now_ms: i64, lease_expires_at_ms: i64) -> MutationClaimRequest {
    MutationClaimRequest {
        owner: owner.into(),
        now_ms,
        lease_expires_at_ms,
    }
}

async fn record_contract<S: Storage>(storage: &mut S) {
    storage
        .put_batch(vec![
            (key("ROOT_QUERY"), record("root")),
            (key("__meta:identity"), record("meta")),
            (key("Thing:"), record("empty-id")),
            (key("Type:9"), record("type-9")),
            (key("Type0:1"), record("type0-1")),
            (key("Other:1"), record("other")),
            (key("Type:0"), record("type-0")),
            (key("Type0:0"), record("type0-first")),
            (key("Type:a"), record("type-a")),
            (key("Type:a:colon"), record("colon-id")),
            (key("Type:a:colon:again"), record("multiple-colon-id")),
            (key("Type0:0"), record("type0-last")),
        ])
        .await
        .unwrap();

    let aligned = storage
        .get_batch(&[
            key("Missing:leading"),
            key("ROOT_QUERY"),
            key("__meta:identity"),
            key("Thing:"),
            key("Type:a:colon:again"),
            key("Missing:middle"),
            key("Type0:0"),
            key("Type0:0"),
            key("Missing:trailing"),
        ])
        .await
        .unwrap();
    assert_eq!(
        aligned,
        vec![
            None,
            Some(record("root")),
            Some(record("meta")),
            Some(record("empty-id")),
            Some(record("multiple-colon-id")),
            None,
            Some(record("type0-last")),
            Some(record("type0-last")),
            None,
        ]
    );

    storage
        .delete_batch(&[key("Missing:delete"), key("Type:a"), key("Type:a")])
        .await
        .unwrap();
    assert_eq!(storage.get_batch(&[key("Type:a")]).await.unwrap(), [None]);
    storage.delete_batch(&[]).await.unwrap();
    storage
        .put_batch(vec![(key("Type:a"), record("restored"))])
        .await
        .unwrap();
}

async fn search_projection_contract<S: Storage>(storage: &mut S) {
    let searchable_key = key("GraphqlSoupDocument:search-1");
    let mut searchable = Record::default();
    searchable.fields.insert(
        "__typename".into(),
        CacheValue::String("GraphqlSoupDocument".into()),
    );
    searchable
        .fields
        .insert("name".into(), CacheValue::String("Quarterly Plan".into()));
    searchable.fields.insert(
        "updatedAt".into(),
        CacheValue::Number(cache_core::value::CacheNumber::PosInt(123)),
    );
    assert_eq!(
        project_search_documents(&searchable_key, &searchable).len(),
        1
    );
    storage
        .put_batch(vec![(searchable_key.clone(), searchable)])
        .await
        .unwrap();
    let loaded = storage
        .load_search_documents(SearchProfile::QuickAccessV1, "document")
        .await
        .unwrap();
    assert!(
        loaded
            .iter()
            .any(|document| document.record_key == searchable_key)
    );
    let browsed = storage
        .browse_search_documents(SearchProfile::QuickAccessV1, "document", None, 1)
        .await
        .unwrap();
    assert_eq!(browsed.len(), 1);
    assert_eq!(browsed[0].record_key, searchable_key);

    storage
        .delete_batch(std::slice::from_ref(&searchable_key))
        .await
        .unwrap();
    assert!(
        storage
            .load_search_documents(SearchProfile::QuickAccessV1, "document")
            .await
            .unwrap()
            .iter()
            .all(|document| document.record_key != searchable_key)
    );
}

async fn reopen_contract<F: BackendFactory>(
    factory: &mut F,
    mut storage: F::Backend,
) -> F::Backend {
    let first_entry = fully_populated_queued();
    let second_entry = queued("ReopenSecond");
    let first = storage.enqueue_mutation(first_entry.clone()).await.unwrap();
    let second = storage
        .enqueue_mutation(second_entry.clone())
        .await
        .unwrap();
    assert!(second > first);

    let mut storage = factory.reopen(storage);
    assert_eq!(
        storage
            .get_batch(&[key("ROOT_QUERY"), key("Type:9"), key("Type:a:colon:again"),])
            .await
            .unwrap(),
        [
            Some(record("root")),
            Some(record("type-9")),
            Some(record("multiple-colon-id")),
        ]
    );
    let loaded = storage.load_mutation_queue().await.unwrap();
    assert_eq!(
        loaded.iter().map(|entry| entry.id).collect::<Vec<_>>(),
        [first, second]
    );
    assert_eq!(loaded[0].mutation, first_entry.mutation);
    assert_eq!(loaded[0].optimistic, first_entry.optimistic);
    assert_eq!(loaded[1].mutation, second_entry.mutation);
    assert_eq!(loaded[1].optimistic, second_entry.optimistic);

    let first_claim = storage
        .claim_next_mutation(claim_request("reopen-first", 0, 1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first_claim.queued.mutation.attempt_count, 8);
    assert_eq!(first_claim.lease_generation, 12);
    assert!(
        storage
            .discard_mutation(first, token("reopen-first", 12))
            .await
            .unwrap()
    );
    let second_claim = storage
        .claim_next_mutation(claim_request("reopen-second", 0, 1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second_claim.queued.id, second);
    assert!(
        storage
            .discard_mutation(
                second,
                token("reopen-second", second_claim.lease_generation),
            )
            .await
            .unwrap()
    );
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage.get_batch(&[key("Type:9")]).await.unwrap(),
        [Some(record("type-9"))],
        "discard must not change existing records"
    );
    storage
}

async fn queue_contract<S: Storage>(storage: &mut S) {
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage.queue_diagnostics().await.unwrap(),
        cache_core::store::QueueDiagnostics {
            availability: cache_core::store::QueueDiagnosticsAvailability::Available,
            depth: 0,
            oldest_created_at_ms: None,
        }
    );
    assert!(
        storage
            .claim_next_mutation(claim_request("empty", 0, 1))
            .await
            .unwrap()
            .is_none()
    );

    let absent = token("absent", 1);
    assert!(
        !storage
            .defer_mutation(999, absent.clone(), 2, "absent".into(), true)
            .await
            .unwrap()
    );
    assert!(
        !storage
            .complete_mutation(999, absent.clone(), Vec::new())
            .await
            .unwrap()
    );
    assert!(!storage.discard_mutation(999, absent).await.unwrap());

    let first = storage.enqueue_mutation(queued("First")).await.unwrap();
    let second = storage.enqueue_mutation(queued("Second")).await.unwrap();
    assert!(second > first);
    assert_eq!(
        storage.queue_diagnostics().await.unwrap(),
        cache_core::store::QueueDiagnostics {
            availability: cache_core::store::QueueDiagnosticsAvailability::Available,
            depth: 2,
            oldest_created_at_ms: Some(1),
        }
    );
    let first_claim = storage
        .claim_next_mutation(claim_request("runner-a", 1, 10))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first_claim.queued.id, first);
    assert_eq!(first_claim.queued.mutation.attempt_count, 1);
    assert_eq!(first_claim.lease_generation, 1);
    assert!(
        storage
            .claim_next_mutation(claim_request("runner-b", 9, 20))
            .await
            .unwrap()
            .is_none(),
        "a leased strict head must block the second row"
    );
    let expired_reclaim = storage
        .claim_next_mutation(claim_request("runner-b", 10, 15))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(expired_reclaim.queued.id, first);
    assert_eq!(expired_reclaim.queued.mutation.attempt_count, 2);
    assert_eq!(expired_reclaim.lease_generation, 2);
    assert!(
        !storage
            .defer_mutation(
                first,
                token("runner-a", first_claim.lease_generation),
                20,
                "stale".into(),
                true,
            )
            .await
            .unwrap()
    );
    assert!(
        !storage
            .discard_mutation(first, token("runner-a", first_claim.lease_generation))
            .await
            .unwrap()
    );
    assert!(
        storage
            .defer_mutation(
                first,
                token("runner-b", expired_reclaim.lease_generation),
                20,
                "retry".into(),
                true,
            )
            .await
            .unwrap()
    );
    let deferred = storage.load_mutation_queue().await.unwrap();
    assert_eq!(deferred.len(), 2);
    assert_eq!(deferred[0].id, first);
    assert_eq!(deferred[0].mutation.attempt_count, 2);
    assert_eq!(deferred[0].mutation.next_attempt_at_ms, Some(20));
    assert_eq!(deferred[0].mutation.lease_owner, None);
    assert_eq!(deferred[0].mutation.lease_expires_at_ms, None);
    assert_eq!(deferred[0].mutation.lease_generation, 2);
    assert_eq!(deferred[0].mutation.last_error.as_deref(), Some("retry"));
    assert!(
        storage
            .claim_next_mutation(claim_request("runner-c", 19, 30))
            .await
            .unwrap()
            .is_none(),
        "a deferred strict head must block the second row"
    );

    let retry_claim = storage
        .claim_next_mutation(claim_request("runner-c", 20, 30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retry_claim.queued.id, first);
    assert_eq!(retry_claim.queued.mutation.attempt_count, 3);
    assert_eq!(retry_claim.lease_generation, 3);
    assert!(
        !storage
            .discard_mutation(first, token("runner-b", expired_reclaim.lease_generation))
            .await
            .unwrap()
    );
    assert!(
        storage
            .discard_mutation(first, token("runner-c", retry_claim.lease_generation))
            .await
            .unwrap()
    );

    let second_claim = storage
        .claim_next_mutation(claim_request("runner-d", 20, 25))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second_claim.queued.id, second);
    assert_eq!(second_claim.queued.mutation.attempt_count, 1);
    assert!(
        storage
            .defer_mutation(
                second,
                token("runner-d", second_claim.lease_generation),
                30,
                "second retry".into(),
                false,
            )
            .await
            .unwrap()
    );
    assert!(
        storage
            .claim_next_mutation(claim_request("runner-e", 29, 40))
            .await
            .unwrap()
            .is_none()
    );
    let second_retry = storage
        .claim_next_mutation(claim_request("runner-e", 30, 40))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second_retry.queued.id, second);
    assert_eq!(second_retry.queued.mutation.attempt_count, 2);
    assert!(
        !storage
            .complete_mutation(
                second,
                token("runner-d", second_claim.lease_generation),
                vec![(key("Result:stale"), record("must-not-write"))],
            )
            .await
            .unwrap()
    );
    assert_eq!(
        storage.get_batch(&[key("Result:stale")]).await.unwrap(),
        [None]
    );
    assert!(
        storage
            .complete_mutation(
                second,
                token("runner-e", second_retry.lease_generation),
                vec![(key("Result:complete"), record("committed"))],
            )
            .await
            .unwrap()
    );
    assert_eq!(
        storage.get_batch(&[key("Result:complete")]).await.unwrap(),
        [Some(record("committed"))]
    );
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert!(
        storage
            .claim_next_mutation(claim_request("empty-again", 40, 50))
            .await
            .unwrap()
            .is_none()
    );
}

async fn retry_budget_contract<F: BackendFactory>(
    factory: &mut F,
    mut storage: F::Backend,
) -> F::Backend {
    let id = storage
        .enqueue_mutation(queued("RetryBudget"))
        .await
        .unwrap();
    for (index, (server_failure, expected_count)) in
        [(true, 1), (false, 1), (true, 2)].into_iter().enumerate()
    {
        let now = index as i64;
        let claimed = storage
            .claim_next_mutation(claim_request("runner", now, now + 1))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.queued.id, id);
        assert_eq!(claimed.queued.mutation.attempt_count, index as u32 + 1);
        let claim = token("runner", claimed.lease_generation);
        assert!(
            storage
                .defer_mutation(id, claim.clone(), now + 1, "retry".into(), server_failure)
                .await
                .unwrap()
        );
        // A duplicate result must not charge the same attempt twice.
        assert!(
            !storage
                .defer_mutation(id, claim, now + 1, "duplicate".into(), true)
                .await
                .unwrap()
        );
        storage = factory.reopen(storage);
        let queue = storage.load_mutation_queue().await.unwrap();
        assert_eq!(queue[0].mutation.server_failure_count, expected_count);
    }
    let claimed = storage
        .claim_next_mutation(claim_request("next-tab", 3, 4))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.queued.mutation.server_failure_count, 2);
    assert!(
        storage
            .discard_mutation(id, token("next-tab", claimed.lease_generation))
            .await
            .unwrap()
    );
    storage
}

async fn clear_contract<S: Storage>(storage: &mut S) {
    let before_clear = storage.enqueue_mutation(queued("Clear")).await.unwrap();
    storage.clear().await.unwrap();
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage
            .get_batch(&[
                key("ROOT_QUERY"),
                key("__meta:identity"),
                key("Thing:"),
                key("Type0:0"),
                key("Type:9"),
                key("Other:1"),
                key("Result:complete"),
            ])
            .await
            .unwrap(),
        [None, None, None, None, None, None, None]
    );
    assert!(
        storage
            .claim_next_mutation(claim_request("after-clear", 50, 60))
            .await
            .unwrap()
            .is_none()
    );
    let after_clear = storage
        .enqueue_mutation(queued("AfterClear"))
        .await
        .unwrap();
    assert!(after_clear > before_clear);
    storage.clear().await.unwrap();
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
}

fn occurrence(event: &str, link: &str, time: &[(&str, &str)]) -> Record {
    let mut record = Record::default();
    for (field, value) in [
        (
            "__typename",
            CacheValue::String("GraphqlCalendarOccurrence".into()),
        ),
        ("eventId", CacheValue::String(event.into())),
        ("linkId", CacheValue::String(link.into())),
        ("isCancelled", CacheValue::Bool(false)),
        (
            "time",
            CacheValue::Object(
                time.iter()
                    .map(|(field, value)| {
                        ((*field).to_owned(), CacheValue::String((*value).into()))
                    })
                    .collect(),
            ),
        ),
    ] {
        record.fields.insert(field.into(), value);
    }
    record
}

async fn calendar_contract<F: BackendFactory>(
    factory: &mut F,
    mut storage: F::Backend,
) -> F::Backend {
    // 2026-10-05T00:00:00Z through 2026-10-12, and the same dates for all-day rows.
    let week = CalendarRangeRequest {
        start_ms: 1_791_158_400_000,
        end_ms: 1_791_763_200_000,
        start_day: 20_731,
        end_day: 20_738,
        event_key: None,
    };
    let standup = key("GraphqlCalendarOccurrence:e1:2026-10-06T09:00:00+00:00");
    let moved = key("GraphqlCalendarOccurrence:e1:2026-10-07T09:00:00+00:00");
    let holiday = key("GraphqlCalendarOccurrence:e2:2026-10-09");
    let other_link = key("GraphqlCalendarOccurrence:e3:2026-10-08T09:00:00+00:00");
    let timed = |starts_at, ends_at| {
        [
            ("__typename", "GraphqlTimedEventTime"),
            ("startsAt", starts_at),
            ("endsAt", ends_at),
        ]
    };
    storage
        .put_batch(vec![
            (
                standup.clone(),
                occurrence(
                    "e1",
                    "l1",
                    &timed("2026-10-06T09:00:00+00:00", "2026-10-06T09:30:00+00:00"),
                ),
            ),
            (
                moved.clone(),
                occurrence(
                    "e1",
                    "l1",
                    &timed("2026-10-07T09:00:00+00:00", "2026-10-07T09:30:00+00:00"),
                ),
            ),
            (
                holiday.clone(),
                occurrence(
                    "e2",
                    "l1",
                    &[
                        ("__typename", "GraphqlAllDayEventTime"),
                        ("startDate", "2026-10-09"),
                        ("endDate", "2026-10-10"),
                    ],
                ),
            ),
            (
                other_link.clone(),
                occurrence(
                    "e3",
                    "l2",
                    &timed("2026-10-08T09:00:00+00:00", "2026-10-08T10:00:00+00:00"),
                ),
            ),
        ])
        .await
        .unwrap();
    let outcome = storage
        .calendar_commit(&CalendarCommit {
            coverage: week.spans().to_vec(),
            replaced_events: vec![CalendarReplacedEvent {
                event_key: key("GraphqlCalendarEvent:e1"),
                occurrence_keys: vec![standup.clone()],
            }],
            removed_link_ids: vec!["l2".into()],
            watermark: Some(CalendarWatermarkUpdate::Merge {
                links: vec![CalendarLinkWatermark {
                    link_id: "l1".into(),
                    seq: 4,
                }],
            }),
            freshness: Some(CalendarFreshness::Fresh),
            ..CalendarCommit::default()
        })
        .await
        .unwrap();
    let mut expected_deleted = vec![moved, other_link];
    expected_deleted.sort();
    assert_eq!(outcome.deleted_keys, expected_deleted);

    let storage = factory.reopen(storage);
    let mut snapshot = storage.query_calendar_ranges(&week).await.unwrap();
    snapshot
        .rows
        .sort_by(|left, right| left.record_key.cmp(&right.record_key));
    assert_eq!(
        snapshot
            .rows
            .iter()
            .map(|row| (row.record_key.clone(), row.span))
            .collect::<Vec<_>>(),
        [
            (
                standup,
                CalendarSpan {
                    kind: CalendarSpanKind::Timed,
                    start: 1_791_277_200_000,
                    end: 1_791_279_000_000,
                }
            ),
            (
                holiday,
                CalendarSpan {
                    kind: CalendarSpanKind::AllDay,
                    start: 20_735,
                    end: 20_736,
                }
            ),
        ]
    );
    assert_eq!(snapshot.coverage, week.spans());
    assert_eq!(
        snapshot.sync,
        CalendarSyncState {
            watermark: Some(vec![CalendarLinkWatermark {
                link_id: "l1".into(),
                seq: 4,
            }]),
            freshness: CalendarFreshness::Fresh,
        }
    );
    storage
}

async fn common_contract<F: BackendFactory>(
    factory: &mut F,
    mut storage: F::Backend,
) -> F::Backend {
    record_contract(&mut storage).await;
    search_projection_contract(&mut storage).await;
    let mut storage = reopen_contract(factory, storage).await;
    queue_contract(&mut storage).await;
    let storage = retry_budget_contract(factory, storage).await;
    let mut storage = calendar_contract(factory, storage).await;
    clear_contract(&mut storage).await;
    assert_eq!(
        storage
            .query_calendar_ranges(&CalendarRangeRequest {
                start_ms: 0,
                end_ms: i64::MAX,
                start_day: 0,
                end_day: i64::MAX,
                event_key: None,
            })
            .await
            .unwrap(),
        Default::default()
    );
    storage
}

fn run<F: BackendFactory>() {
    let (mut factory, storage) = F::create();
    let storage = block_on(common_contract(&mut factory, storage));
    factory.finish(storage);
}

#[test]
fn in_memory_storage_satisfies_shared_contract() {
    run::<InMemoryFactory>();
}

#[test]
fn turso_storage_satisfies_shared_contract() {
    run::<TursoFactory>();
}
