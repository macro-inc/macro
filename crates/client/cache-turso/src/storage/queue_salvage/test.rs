use super::file::SalvageFile;
use super::*;
use crate::storage::test::queued;
use crate::{PhysicalResetReason, TursoMemoryDatabase};
use cache_core::engine::authority::AUTHORITY_META_KEY;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken, MutationId};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, Record};
use pollster::block_on;
use predicate_index::{
    IndexDocument, IntegerFact, OptimisticProjectionState, OptimisticUncertainty,
    PendingOptimisticProjection, Profile, ProjectionIncompleteKind,
    RecordKey as PredicateRecordKey, Token,
};
use proptest::prelude::*;

const SCOPE: &str = "salvage";

fn fresh() -> TursoStorage {
    TursoStorage::open_in_memory(SCOPE).unwrap()
}

fn rows(storage: &TursoStorage, sql: &str) -> Vec<Vec<Value>> {
    driver::query(&storage.connection(), sql, Vec::new()).unwrap()
}

fn execute(storage: &TursoStorage, sql: &str) {
    driver::execute(&storage.connection(), sql, Vec::new()).unwrap();
}

fn metadata(key: &str, value: &str) -> (EntityKey<'static>, Record) {
    let mut record = Record::default();
    record
        .fields
        .insert("identity".into(), CacheValue::String(value.into()));
    (EntityKey(key.to_owned().into()), record)
}

/// Everything a queue consists of, in an order no document ID decides.
fn contents(storage: &TursoStorage) -> Vec<Vec<Vec<Value>>> {
    [
        "SELECT * FROM mutation_queue ORDER BY id",
        "SELECT * FROM optimistic_layers ORDER BY mutation_id",
        "SELECT key, value FROM meta WHERE key GLOB 'mutation-server-failures:*' ORDER BY key",
        "SELECT owner_mutation_id, record_key, profile, partition, state, incomplete_kind FROM optimistic_index_documents ORDER BY record_key",
        "SELECT d.record_key, f.attribute, f.value FROM optimistic_exact_facts AS f JOIN optimistic_index_documents AS d ON d.id = f.document_id ORDER BY 1, 2, 3",
        "SELECT d.record_key, f.attribute, f.value FROM optimistic_integer_facts AS f JOIN optimistic_index_documents AS d ON d.id = f.document_id ORDER BY 1, 2, 3",
        "SELECT d.record_key, f.attribute, f.value FROM optimistic_sort_facts AS f JOIN optimistic_index_documents AS d ON d.id = f.document_id ORDER BY 1, 2, 3",
        "SELECT d.record_key, f.attribute FROM optimistic_uncertain_attributes AS f JOIN optimistic_index_documents AS d ON d.id = f.document_id ORDER BY 1, 2",
    ]
    .map(|sql| rows(storage, sql))
    .into()
}

fn salvage(storage: &TursoStorage) -> QueueRead {
    storage.salvage_queue(SCOPE, None, 0)
}

/// Through the side file, as a wipe carries it.
fn through_file(queue: &SalvagedQueue) -> SalvagedQueue {
    SalvageFile::decode(&queue.to_frame()).into_queue().unwrap()
}

fn carried(storage: &TursoStorage) -> SalvagedQueue {
    let read = salvage(storage);
    assert!(read.complete && !read.abandoned);
    assert_eq!(read.dropped, 0);
    through_file(&read.queue.unwrap())
}

fn projection(key: &str, variant: u8) -> PendingOptimisticProjection {
    let token = |value: &str| Token::new(value).unwrap();
    let record_key = PredicateRecordKey::new(key).unwrap();
    let state = match variant % 3 {
        0 => OptimisticProjectionState::Deleted {
            record_key,
            profile: Profile::new(token("profile-v1")),
            partition: token("thing"),
        },
        1 if variant % 2 == 0 => OptimisticProjectionState::Incomplete {
            record_key,
            profile: Profile::new(token("profile-v1")),
            partition: token("thing"),
            kind: ProjectionIncompleteKind::Dirty,
        },
        _ => OptimisticProjectionState::Complete(IndexDocument {
            record_key,
            profile: Profile::new(token("profile-v1")),
            partition: token("thing"),
            exact_facts: vec![predicate_index::ExactFact {
                attribute: token("owner"),
                value: predicate_index::ExactValue::new([variant]).unwrap(),
            }],
            integer_facts: vec![IntegerFact {
                attribute: token("updated-at"),
                value: i64::from(variant),
            }],
            sort_facts: vec![IntegerFact {
                attribute: token("updated-at"),
                value: i64::MIN + i64::from(variant),
            }],
        }),
    };
    PendingOptimisticProjection {
        state,
        uncertainty: if variant > 200 {
            OptimisticUncertainty::AllExcept([token("owner")].into())
        } else {
            OptimisticUncertainty::Attributes([token("file-type")].into())
        },
    }
}

async fn enqueue(storage: &mut TursoStorage, label: &str) -> MutationId {
    storage
        .enqueue_mutation_with_shadow(
            queued(label),
            vec![projection(&format!("Thing:{label}"), 1)],
        )
        .await
        .unwrap()
}

async fn claim(
    storage: &mut TursoStorage,
    now_ms: i64,
) -> Option<(MutationId, MutationClaimToken)> {
    let claimed = storage
        .claim_next_mutation(MutationClaimRequest {
            owner: "page".into(),
            now_ms,
            lease_expires_at_ms: now_ms + 10,
        })
        .await
        .unwrap()?;
    Some((
        claimed.queued.id,
        MutationClaimToken {
            owner: "page".into(),
            generation: claimed.lease_generation,
        },
    ))
}

#[derive(Clone, Debug)]
enum Action {
    Enqueue(u8, u8),
    Claim,
    Defer(bool),
    Settle,
}

fn action() -> impl Strategy<Value = Action> {
    prop_oneof![
        3 => (0u8..5, any::<u8>()).prop_map(|(key, variant)| Action::Enqueue(key, variant)),
        1 => Just(Action::Claim),
        1 => any::<bool>().prop_map(Action::Defer),
        1 => Just(Action::Settle),
    ]
}

async fn run(storage: &mut TursoStorage, actions: Vec<Action>) {
    let mut now = 0;
    for action in actions {
        now += 100;
        match action {
            Action::Enqueue(key, variant) => {
                storage
                    .enqueue_mutation_with_shadow(
                        queued("Edit"),
                        vec![projection(&format!("Thing:{key}"), variant)],
                    )
                    .await
                    .unwrap();
            }
            Action::Claim => {
                claim(storage, now).await;
            }
            Action::Defer(server) => {
                if let Some((id, token)) = claim(storage, now).await {
                    storage
                        .defer_mutation(id, token, now + 1, "failed".into(), server)
                        .await
                        .unwrap();
                }
            }
            Action::Settle => {
                if let Some((id, token)) = claim(storage, now).await {
                    storage.discard_mutation(id, token).await.unwrap();
                }
            }
        }
    }
}

proptest! {
    #[test]
    fn any_queue_reaches_the_next_database_unchanged(
        actions in proptest::collection::vec(action(), 1..30),
    ) {
        block_on(async {
            let mut storage = fresh();
            run(&mut storage, actions).await;
            let Some(queue) = salvage(&storage).queue else {
                assert!(storage.load_mutation_queue().await.unwrap().is_empty());
                return;
            };
            let mut next = fresh();
            let imported = next.import_queue(&through_file(&queue), 0).unwrap();
            assert_eq!(imported, QueueImport { kept: queue.len(), dropped: 0, complete: true });
            assert_eq!(contents(&next), contents(&storage));
            assert_eq!(
                next.load_mutation_queue().await.unwrap(),
                storage.load_mutation_queue().await.unwrap()
            );
            // An ID stays used once it was given out, so a claim a page still
            // holds never settles another write.
            assert_eq!(
                enqueue(&mut next, "Next").await,
                enqueue(&mut storage, "Next").await
            );
        });
    }

    #[test]
    fn damage_never_yields_another_queue(
        at in any::<proptest::sample::Index>(),
        flip in 1u8..,
        cut in any::<proptest::sample::Index>(),
    ) {
        let (first, second) = block_on(async {
            let mut storage = fresh();
            enqueue(&mut storage, "First").await;
            let first = carried(&storage);
            enqueue(&mut storage, "Second").await;
            (first, carried(&storage))
        });
        let whole = [first.to_frame(), SalvageFile::read_attempt(), second.to_frame()].concat();

        let mut damaged = whole.clone();
        let at = at.index(damaged.len());
        damaged[at] ^= flip;
        let damaged = SalvageFile::decode(&damaged).into_queue();
        assert!(damaged.is_none() || damaged.as_ref() == Some(&first) || damaged.as_ref() == Some(&second));

        let cut = cut.index(whole.len());
        let torn = SalvageFile::decode(&whole[..cut]);
        assert!(torn.end() <= cut as u64);
        assert_eq!(torn.queue().is_some(), cut >= first.to_frame().len());
        // What is written over a torn end is read back.
        let mut mended = whole[..torn.end() as usize].to_vec();
        mended.extend(second.to_frame());
        assert_eq!(SalvageFile::decode(&mended).into_queue(), Some(second));
    }

    #[test]
    fn any_bytes_decode(bytes in proptest::collection::vec(any::<u8>(), 0..200)) {
        assert!(SalvageFile::decode(&bytes).queue().is_none());
    }
}

#[test]
fn import_attempts_count_since_their_queue() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        let queue = carried(&storage).to_frame();
        let attempts = [
            SalvageFile::read_attempt(),
            SalvageFile::import_attempt(),
            SalvageFile::import_attempt(),
        ]
        .concat();
        let file = SalvageFile::decode(&[SalvageFile::read_attempt(), queue.clone()].concat());
        assert_eq!((file.reads(), file.imports()), (1, 0));
        let file = SalvageFile::decode(&[queue.clone(), attempts.clone(), queue.clone()].concat());
        assert_eq!((file.reads(), file.imports()), (1, 0));
        let file = SalvageFile::decode(&[queue.clone(), attempts.clone()].concat());
        assert_eq!((file.reads(), file.imports()), (1, 2));
        assert_eq!(file.end(), (queue.len() + attempts.len()) as u64);
        assert!(SalvageFile::decode(&[]).is_blank());
    });
}

#[test]
fn the_account_and_policy_travel_and_the_database_marker_stays() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        storage
            .put_batch(vec![
                metadata(IDENTITY_META_KEY, "account"),
                metadata(AUTHORITY_META_KEY, "policy"),
                metadata(STORAGE_GENERATION_META_KEY, "this database"),
                metadata("Thing:1", "refetchable"),
            ])
            .await
            .unwrap();
        let mut next = fresh();
        next.import_queue(&carried(&storage), 0).unwrap();
        let keys = rows(&next, "SELECT __typename, id FROM records ORDER BY id");
        assert_eq!(
            keys,
            [
                vec![text("__meta"), text("authority")],
                vec![text("__meta"), text("identity")],
            ]
        );
        for key in [IDENTITY_META_KEY, AUTHORITY_META_KEY] {
            let key = EntityKey(key.into());
            assert_eq!(
                next.get_batch(std::slice::from_ref(&key)).await.unwrap(),
                storage.get_batch(&[key]).await.unwrap()
            );
        }
    });
}

#[test]
fn a_queue_whose_account_cannot_be_read_is_not_carried() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        storage
            .put_batch(vec![metadata(IDENTITY_META_KEY, "account")])
            .await
            .unwrap();
        execute(&storage, "UPDATE records SET value = 'not a record'");
        assert_eq!(salvage(&storage), QueueRead::default());
    });
}

#[test]
fn a_queue_never_enters_another_accounts_database() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        storage
            .put_batch(vec![metadata(IDENTITY_META_KEY, "account")])
            .await
            .unwrap();
        let queue = carried(&storage);
        let mut next = fresh();
        next.put_batch(vec![metadata(IDENTITY_META_KEY, "another")])
            .await
            .unwrap();
        let import = QueueImport {
            kept: 0,
            dropped: 1,
            complete: false,
        };
        assert_eq!(next.import_queue(&queue, 0).unwrap(), import);
        assert!(next.load_mutation_queue().await.unwrap().is_empty());

        // Nor one that names no account.
        let mut unnamed = fresh();
        enqueue(&mut unnamed, "First").await;
        assert_eq!(next.import_queue(&carried(&unnamed), 0).unwrap(), import);
    });
}

#[test]
fn an_unreadable_write_leaves_the_others() {
    block_on(async {
        let mut storage = fresh();
        for label in ["First", "Second", "Third"] {
            enqueue(&mut storage, label).await;
        }
        execute(
            &storage,
            "UPDATE optimistic_layers SET normalized_updates = x'ff' WHERE mutation_id = 2",
        );
        let read = salvage(&storage);
        assert_eq!((read.dropped, read.complete), (1, true));
        let mut next = fresh();
        next.import_queue(&read.queue.unwrap(), 0).unwrap();
        let kept = next.load_mutation_queue().await.unwrap();
        assert_eq!(kept.iter().map(|row| row.id).collect::<Vec<_>>(), [1, 3]);
        assert_eq!(
            rows(
                &next,
                "SELECT owner_mutation_id FROM optimistic_index_documents ORDER BY 1"
            ),
            [vec![Value::from_i64(1)], vec![Value::from_i64(3)]]
        );
    });
}

#[test]
fn an_invalid_projection_is_left_behind() {
    block_on(async {
        let mut storage = fresh();
        for label in ["First", "Second"] {
            enqueue(&mut storage, label).await;
        }
        execute(
            &storage,
            "UPDATE optimistic_index_documents SET state = 9 WHERE owner_mutation_id = 1",
        );
        let mut next = fresh();
        next.import_queue(&carried(&storage), 0).unwrap();
        assert_eq!(next.load_mutation_queue().await.unwrap().len(), 2);
        assert_eq!(
            rows(
                &next,
                "SELECT owner_mutation_id FROM optimistic_index_documents"
            ),
            [vec![Value::from_i64(2)]]
        );
        crate::storage::validate_optimistic_shadow_consistency(&next.connection()).unwrap();
    });
}

#[test]
fn an_import_runs_once() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        let queue = carried(&storage);
        let mut next = fresh();
        assert_eq!(next.import_queue(&queue, 0).unwrap().kept, 1);
        let (id, token) = claim(&mut next, 0).await.unwrap();
        next.discard_mutation(id, token).await.unwrap();
        assert_eq!(
            next.import_queue(&queue, 0).unwrap(),
            QueueImport {
                complete: true,
                ..QueueImport::default()
            }
        );
        assert!(next.load_mutation_queue().await.unwrap().is_empty());
        // A wipe that finds the queue still in its file knows it was settled.
        assert_eq!(next.salvage_queue(SCOPE, Some(queue), 0).queue, None);
    });
}

#[test]
fn a_database_that_was_never_wiped_keeps_its_own_queue() {
    block_on(async {
        let mut storage = fresh();
        storage
            .put_batch(vec![metadata(STORAGE_GENERATION_META_KEY, "this database")])
            .await
            .unwrap();
        enqueue(&mut storage, "First").await;
        let queue = carried(&storage);
        let (id, token) = claim(&mut storage, 0).await.unwrap();
        storage.discard_mutation(id, token).await.unwrap();
        assert_eq!(
            storage.import_queue(&queue, 0).unwrap(),
            QueueImport {
                complete: true,
                ..QueueImport::default()
            }
        );
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());
        assert_eq!(storage.salvage_queue(SCOPE, Some(queue), 0).queue, None);
    });
}

#[test]
fn a_queue_not_imported_yet_survives_another_wipe() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        let queue = carried(&storage);
        for next in [TursoMemoryDatabase::new("again.db").open(SCOPE).unwrap(), {
            let broken = fresh();
            execute(&broken, "DROP TABLE mutation_queue");
            broken
        }] {
            let read = next.salvage_queue(SCOPE, Some(queue.clone()), 0);
            assert_eq!(read.queue, Some(queue.clone()));
            assert_eq!(read.dropped, 0);
        }
    });
}

#[test]
fn two_queues_join_behind_the_newer_one() {
    block_on(async {
        let mut older = fresh();
        enqueue(&mut older, "Older").await;
        claim(&mut older, 0).await.unwrap();
        let older = carried(&older);
        let mut newer = fresh();
        enqueue(&mut newer, "Newer").await;
        enqueue(&mut newer, "Settled").await;

        let expected = |storage: &TursoStorage| {
            rows(
                storage,
                "SELECT m.id, m.operation_name, m.lease_owner, d.record_key FROM mutation_queue AS m JOIN optimistic_index_documents AS d ON d.owner_mutation_id = m.id ORDER BY m.id",
            )
        };
        let mut joined = fresh();
        let read = newer.salvage_queue(SCOPE, Some(older.clone()), 0);
        joined
            .import_queue(&through_file(&read.queue.unwrap()), 0)
            .unwrap();
        newer.import_queue(&older, 0).unwrap();
        for storage in [&joined, &newer] {
            let ids = expected(storage)
                .into_iter()
                .map(|row| {
                    (
                        row[0].clone(),
                        row[1].clone(),
                        row[2].clone(),
                        row[3].clone(),
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(
                ids,
                [
                    (
                        Value::from_i64(1),
                        text("Newer"),
                        Value::Null,
                        text("Thing:Newer")
                    ),
                    (
                        Value::from_i64(2),
                        text("Settled"),
                        Value::Null,
                        text("Thing:Settled")
                    ),
                    (
                        Value::from_i64(3),
                        text("Older"),
                        Value::Null,
                        text("Thing:Older")
                    ),
                ]
            );
        }
    });
}

#[test]
fn a_write_the_database_already_queues_is_not_queued_twice() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        let queue = carried(&storage);
        let mut next = fresh();
        next.import_queue(&queue, 0).unwrap();
        execute(&next, "DELETE FROM meta WHERE key = 'salvaged-queue'");
        assert_eq!(
            next.import_queue(&queue, 0).unwrap(),
            QueueImport {
                kept: 0,
                dropped: 1,
                complete: false
            }
        );
        assert_eq!(next.load_mutation_queue().await.unwrap().len(), 1);
    });
}

#[test]
fn a_queue_whose_import_keeps_ending_in_a_wipe_is_given_up() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        let mut queue = carried(&storage);
        for round in 0..i64::from(super::read::MAX_ROUNDS) - 1 {
            let mut next = fresh();
            next.import_queue(&queue, round * 1_000).unwrap();
            let read = next.salvage_queue(SCOPE, None, round * 1_000 + 1);
            queue = read.queue.unwrap();
        }
        let mut last = fresh();
        last.import_queue(&queue, 0).unwrap();
        let read = last.salvage_queue(SCOPE, None, 1);
        assert_eq!((read.abandoned, read.dropped, read.queue), (true, 1, None));
        // A wipe long after the import has another cause.
        let read = last.salvage_queue(SCOPE, None, super::read::IMPORT_SETTLE_MS + 1);
        assert_eq!((read.abandoned, read.dropped), (false, 0));
        let mut next = fresh();
        next.import_queue(&read.queue.unwrap(), 0).unwrap();
        assert!(next.salvage_queue(SCOPE, None, 1).queue.is_some());
    });
}

#[test]
fn a_queue_this_build_cannot_read_is_not_carried() {
    block_on(async {
        for sql in [
            "UPDATE meta SET value = 'another' WHERE key = 'namespace'",
            "UPDATE meta SET value = '1' WHERE key = 'storage_schema_version'",
            "UPDATE meta SET value = 'another' WHERE key = 'scope'",
        ] {
            let mut storage = fresh();
            enqueue(&mut storage, "First").await;
            execute(&storage, sql);
            assert_eq!(salvage(&storage).queue, None, "{sql}");
        }
        // One whose layers a migration keeps is.
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        let previous = cache_core::codec::cache_namespace_at(
            SCOPE,
            cache_core::codec::MIGRATABLE_CACHE_FORMAT_VERSIONS[0],
        );
        execute(
            &storage,
            &format!("UPDATE meta SET value = '{previous}' WHERE key = 'namespace'"),
        );
        assert_eq!(salvage(&storage).queue.unwrap().len(), 1);
    });
}

#[test]
fn a_failed_import_leaves_nothing_and_can_be_tried_again() {
    block_on(async {
        let mut storage = fresh();
        for label in ["First", "Second"] {
            enqueue(&mut storage, label).await;
        }
        let queue = carried(&storage);
        let mut broken = queue.clone();
        broken.rows[1][0] = Value::from_i64(1);
        let mut next = fresh();
        assert!(next.import_queue(&broken, 0).is_err());
        assert!(contents(&next).iter().all(Vec::is_empty));
        let mut next = fresh();
        next.import_queue(&queue, 0).unwrap();
        assert_eq!(contents(&next), contents(&storage));
    });
}

#[test]
fn an_unhealthy_database_takes_no_import() {
    block_on(async {
        let mut storage = fresh();
        enqueue(&mut storage, "First").await;
        let queue = carried(&storage);
        let mut next = fresh();
        let _ = next.latch_result::<()>(Err(TursoStorageError::reset(
            PhysicalResetReason::Corruption,
        )));
        assert!(next.import_queue(&queue, 0).is_err());
    });
}
