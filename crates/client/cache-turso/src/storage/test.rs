use super::*;
use cache_core::normalize::RecordUpdates;
use pollster::block_on;
use std::sync::atomic::{AtomicU8, Ordering};
use turso_core::io::{FileId, FileSyncType};
use turso_core::{
    Buffer, Clock, Completion, CompletionError, File, IO, LimboError, MemoryIO, MonotonicInstant,
    OpenFlags, WallClockInstant,
};

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn record(value: &str) -> Record {
    let mut record = Record::default();
    record.fields.insert(
        "value".into(),
        cache_core::value::CacheValue::String(value.into()),
    );
    record
}

fn queued(label: &str) -> NewQueuedMutation {
    NewQueuedMutation {
        mutation: StoredMutation::new(
            MutationRequest {
                query: format!("mutation {label} {{ update {{ id }} }}"),
                operation_name: Some(label.into()),
                variables_json: "{}".into(),
                identity: Some("identity".into()),
            },
            1,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: "{}".into(),
            normalized_updates: RecordUpdates::default(),
        },
    }
}

fn pending_projection(key: &str, owner: &str, updated_at: i64) -> PendingOptimisticProjection {
    let token = |value| Token::new(value).unwrap();
    PendingOptimisticProjection {
        state: OptimisticProjectionState::Complete(predicate_index::IndexDocument {
            record_key: PredicateRecordKey::new(key).unwrap(),
            profile: Profile::new(token("profile-v1")),
            partition: token("thing"),
            exact_facts: vec![predicate_index::ExactFact {
                attribute: token("owner"),
                value: predicate_index::ExactValue::utf8(owner).unwrap(),
            }],
            integer_facts: vec![predicate_index::IntegerFact {
                attribute: token("updated-at"),
                value: updated_at,
            }],
            sort_facts: vec![predicate_index::IntegerFact {
                attribute: token("updated-at"),
                value: updated_at,
            }],
        }),
        uncertainty: OptimisticUncertainty::Attributes([token("file-type")].into()),
    }
}

fn token(owner: &str, generation: u64) -> MutationClaimToken {
    MutationClaimToken {
        owner: owner.into(),
        generation,
    }
}

fn raw_execute(storage: &TursoStorage, sql: &str, values: Vec<Value>) -> i64 {
    driver::execute(&storage.connection(), sql, values).unwrap()
}

fn raw_scalar(storage: &TursoStorage, sql: &str) -> i64 {
    let rows = driver::query(&storage.connection(), sql, Vec::new()).unwrap();
    required_i64(&rows[0], 0).unwrap()
}

fn expect_reset_reason<T>(result: Result<T, TursoStorageError>, expected: PhysicalResetReason) {
    let Err(error) = result else {
        panic!("reset-required operation unexpectedly succeeded")
    };
    assert_eq!(error.physical_reset_reason(), Some(expected));
}

async fn expect_every_storage_method_latched(
    storage: &mut TursoStorage,
    expected: PhysicalResetReason,
) {
    expect_reset_reason(storage.get_batch(&[key("Thing:1")]).await, expected);
    expect_reset_reason(
        storage
            .put_batch(vec![(key("Thing:2"), record("blocked"))])
            .await,
        expected,
    );
    expect_reset_reason(storage.delete_batch(&[key("Thing:1")]).await, expected);
    expect_reset_reason(storage.enqueue_mutation(queued("Blocked")).await, expected);
    expect_reset_reason(storage.load_mutation_queue().await, expected);
    expect_reset_reason(storage.queue_diagnostics().await, expected);
    expect_reset_reason(
        storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "blocked".into(),
                now_ms: 1,
                lease_expires_at_ms: 2,
            })
            .await,
        expected,
    );
    expect_reset_reason(
        storage
            .defer_mutation(1, token("blocked", 1), 2, "blocked".into())
            .await,
        expected,
    );
    expect_reset_reason(
        storage
            .complete_mutation(1, token("blocked", 1), Vec::new())
            .await,
        expected,
    );
    expect_reset_reason(
        storage.discard_mutation(1, token("blocked", 1)).await,
        expected,
    );
    expect_reset_reason(storage.clear().await, expected);
}

#[test]
fn search_projection_is_write_through_and_recent_query_uses_projection_index() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("search-projection").unwrap();
        let mut document = Record::default();
        document.fields.insert(
            "__typename".into(),
            cache_core::value::CacheValue::String("GraphqlSoupDocument".into()),
        );
        document.fields.insert(
            "name".into(),
            cache_core::value::CacheValue::String("Quarterly Plan".into()),
        );
        document.fields.insert(
            "updatedAt".into(),
            cache_core::value::CacheValue::Number(cache_core::value::CacheNumber::PosInt(123)),
        );
        storage
            .put_batch(vec![
                (key("GraphqlSoupDocument:d1"), document.clone()),
                (key("GraphqlSoupDocument:d2"), document),
            ])
            .await
            .unwrap();

        let columns = driver::query(
            &storage.connection(),
            "PRAGMA table_info('search_documents')",
            Vec::new(),
        )
        .unwrap()
        .into_iter()
        .map(|row| required_text(&row, 1).unwrap())
        .collect::<Vec<_>>();
        assert_eq!(
            columns,
            [
                "profile",
                "__typename",
                "id",
                "bucket",
                "search_text",
                "timestamp_ms",
                "source_hash",
            ]
        );

        let loaded = storage
            .load_search_documents(SearchProfile::QuickAccessV1)
            .await
            .unwrap();
        assert_eq!(loaded.len(), 2);
        assert!(
            loaded
                .iter()
                .all(|document| document.search_text == "quarterly plan")
        );
        let first = storage
            .browse_search_documents(SearchProfile::QuickAccessV1, "document", None, 1)
            .await
            .unwrap();
        assert_eq!(first[0].record_key.as_ref(), "GraphqlSoupDocument:d1");
        let cursor = SearchCursor {
            timestamp_ms: first[0].timestamp_ms,
            record_key: first[0].record_key.clone(),
        };
        let second = storage
            .browse_search_documents(SearchProfile::QuickAccessV1, "document", Some(&cursor), 1)
            .await
            .unwrap();
        assert_eq!(second[0].record_key.as_ref(), "GraphqlSoupDocument:d2");

        let plan = driver::query(
            &storage.connection(),
            &format!("EXPLAIN QUERY PLAN {SEARCH_BROWSE}"),
            vec![
                text("quick-access-v1"),
                text("document"),
                Value::from_i64(25),
            ],
        )
        .unwrap();
        let details = plan
            .iter()
            .filter_map(|row| required_text(row, 3).ok())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            details.contains("search_documents_browse_idx"),
            "browse query did not use projection index: {details}"
        );
        assert!(!details.contains("records"));

        storage
            .delete_batch(&[key("GraphqlSoupDocument:d2")])
            .await
            .unwrap();
        storage
            .put_batch(vec![(key("GraphqlSoupDocument:d1"), record("internal"))])
            .await
            .unwrap();
        assert!(
            storage
                .load_search_documents(SearchProfile::QuickAccessV1)
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn queue_diagnostics_use_one_payload_free_aggregate_query() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("queue-diagnostics").unwrap();
        assert_eq!(
            storage.queue_diagnostics().await.unwrap(),
            QueueDiagnostics {
                availability: QueueDiagnosticsAvailability::Available,
                depth: 0,
                oldest_created_at_ms: None,
            }
        );
        let first = storage.enqueue_mutation(queued("First")).await.unwrap();
        let second = storage.enqueue_mutation(queued("Second")).await.unwrap();
        raw_execute(
            &storage,
            "UPDATE mutation_queue SET created_at_ms = ?2 WHERE id = ?1",
            vec![
                Value::from_i64(mutation_id_to_sql(first).unwrap()),
                Value::from_i64(10),
            ],
        );
        raw_execute(
            &storage,
            "UPDATE mutation_queue SET created_at_ms = ?2 WHERE id = ?1",
            vec![
                Value::from_i64(mutation_id_to_sql(second).unwrap()),
                Value::from_i64(20),
            ],
        );
        assert_eq!(
            storage.queue_diagnostics().await.unwrap(),
            QueueDiagnostics {
                availability: QueueDiagnosticsAvailability::Available,
                depth: 2,
                oldest_created_at_ms: Some(10),
            }
        );
    });
}

#[test]
fn queue_diagnostics_use_the_created_at_covering_index_at_scale() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("queue-diagnostics-plan").unwrap();
        raw_execute(
            &storage,
            "WITH RECURSIVE values_to_insert(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM values_to_insert WHERE value < 10000) INSERT INTO mutation_queue (query, variables_json, created_at_ms) SELECT 'mutation Scale { scale }', '{}', 10001 - value FROM values_to_insert",
            Vec::new(),
        );
        let plan = driver::query(
            &storage.connection(),
            &format!("EXPLAIN QUERY PLAN {QUEUE_DIAGNOSTICS_SELECT}"),
            Vec::new(),
        )
        .unwrap();
        let details = plan
            .iter()
            .filter_map(|row| required_text(row, 3).ok())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            details.contains("mutation_queue_created_at_ms_idx"),
            "diagnostics query did not use the covering timestamp index: {details}"
        );
        assert_eq!(
            storage.queue_diagnostics().await.unwrap(),
            QueueDiagnostics {
                availability: QueueDiagnosticsAvailability::Available,
                depth: 10_000,
                oldest_created_at_ms: Some(1),
            }
        );
    });
}

#[test]
fn queue_diagnostics_failure_never_latches_storage_health() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("queue-diagnostics-health").unwrap();
        storage.arm_fault(TestFault::ResetAfter {
            site: TestFaultSite::Diagnostics,
            index: 0,
            reason: PhysicalResetReason::Io,
        });
        assert_eq!(
            storage
                .queue_diagnostics()
                .await
                .unwrap_err()
                .physical_reset_reason(),
            Some(PhysicalResetReason::Io)
        );
        storage
            .enqueue_mutation(queued("StillHealthy"))
            .await
            .unwrap();
        assert_eq!(storage.queue_diagnostics().await.unwrap().depth, 1);
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}

#[test]
fn fresh_schema_metadata_foreign_keys_quick_check_and_cascade_are_real() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("schema-scope").unwrap();
        assert_eq!(raw_scalar(&storage, "PRAGMA foreign_keys"), 1);
        let quick = driver::query(&storage.connection(), "PRAGMA quick_check", Vec::new()).unwrap();
        assert_eq!(quick.len(), 1);
        assert_eq!(required_text(&quick[0], 0).unwrap(), "ok");
        assert_eq!(raw_scalar(&storage, "SELECT COUNT(*) FROM meta"), 3);

        let violation = driver::execute(
            &storage.connection(),
            LAYER_INSERT,
            vec![Value::from_i64(999), text("{}"), Value::from_blob(vec![0])],
        )
        .unwrap_err();
        assert!(!violation.requires_physical_reset());
        assert_eq!(raw_scalar(&storage, "PRAGMA foreign_keys"), 1);

        let id = storage.enqueue_mutation(queued("Cascade")).await.unwrap();
        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 10,
            })
            .await
            .unwrap()
            .unwrap();
        assert!(
            storage
                .discard_mutation(id, token("runner", claimed.lease_generation))
                .await
                .unwrap()
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_layers"),
            0
        );
    });
}

#[test]
fn enqueue_atomically_replaces_one_effective_shadow_per_key() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("shadow-enqueue").unwrap();
        let key = PredicateRecordKey::new("Thing:1").unwrap();
        let first = storage
            .enqueue_mutation_with_shadow(
                queued("First"),
                vec![pending_projection("Thing:1", "user-1", 10)],
            )
            .await
            .unwrap();
        let loaded = storage
            .load_optimistic_projections(std::slice::from_ref(&key))
            .await
            .unwrap()
            .pop()
            .flatten()
            .unwrap();
        assert_eq!(loaded.owner, first);
        assert!(
            loaded
                .uncertainty
                .affects(&Token::new("file-type").unwrap())
        );

        let second = storage
            .enqueue_mutation_with_shadow(
                queued("Second"),
                vec![pending_projection("Thing:1", "user-2", 20)],
            )
            .await
            .unwrap();
        let loaded = storage
            .load_optimistic_projections(&[key])
            .await
            .unwrap()
            .pop()
            .flatten()
            .unwrap();
        assert_eq!(loaded.owner, second);
        assert!(second > first);
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_index_documents"),
            1
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_exact_facts"),
            1
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_integer_facts"),
            1
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_sort_facts"),
            1
        );

        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Enqueue,
            index: 1,
        });
        assert!(
            storage
                .enqueue_mutation_with_shadow(
                    queued("Failed"),
                    vec![pending_projection("Thing:2", "user-3", 30)],
                )
                .await
                .is_err()
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 2);
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_index_documents"),
            1
        );
    });
}

#[test]
fn incomplete_optimistic_projection_kinds_survive_persistence_and_reload() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("shadow-incomplete-kinds").unwrap();
        let kinds = [
            ProjectionIncompleteKind::Dirty,
            ProjectionIncompleteKind::Missing,
            ProjectionIncompleteKind::IncompatibleVersion,
        ];
        let keys = (1..=3)
            .map(|index| PredicateRecordKey::new(format!("Thing:{index}")).unwrap())
            .collect::<Vec<_>>();
        let projections = keys
            .iter()
            .zip(kinds.iter().copied())
            .map(|(record_key, kind)| PendingOptimisticProjection {
                state: OptimisticProjectionState::Incomplete {
                    record_key: record_key.clone(),
                    profile: Profile::new(Token::new("profile-v1").unwrap()),
                    partition: Token::new("thing").unwrap(),
                    kind,
                },
                uncertainty: OptimisticUncertainty::default(),
            })
            .collect();
        let owner = storage
            .enqueue_mutation_with_shadow(queued("Incomplete"), projections)
            .await
            .unwrap();

        let rows = driver::query(
            &storage.connection(),
            "SELECT state, incomplete_kind FROM optimistic_index_documents ORDER BY record_key",
            Vec::new(),
        )
        .unwrap();
        for (row, kind) in rows.iter().zip(kinds) {
            assert_eq!(required_i64(row, 0).unwrap(), 2);
            assert_eq!(required_i64(row, 1).unwrap(), projection_state_code(kind));
        }

        let loaded = storage.load_optimistic_projections(&keys).await.unwrap();
        for ((projection, record_key), kind) in loaded.into_iter().zip(&keys).zip(kinds) {
            let projection = projection.unwrap();
            assert_eq!(projection.owner, owner);
            assert!(matches!(
                projection.state,
                OptimisticProjectionState::Incomplete {
                    record_key: loaded_key,
                    kind: loaded_kind,
                    ..
                } if loaded_key == *record_key && loaded_kind == kind
            ));
        }
    });
}

#[test]
fn settlement_fences_queue_identity_and_atomically_replaces_affected_shadows() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("shadow-settlement").unwrap();
        let key = PredicateRecordKey::new("Thing:1").unwrap();
        let first = storage
            .enqueue_mutation_with_shadow(
                queued("First"),
                vec![pending_projection("Thing:1", "user-1", 10)],
            )
            .await
            .unwrap();
        let second = storage
            .enqueue_mutation_with_shadow(
                queued("Second"),
                vec![pending_projection("Thing:1", "user-2", 20)],
            )
            .await
            .unwrap();
        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        let claim = token("runner", claimed.lease_generation);
        let replacement = storage
            .load_optimistic_projections(std::slice::from_ref(&key))
            .await
            .unwrap()
            .pop()
            .flatten()
            .unwrap();

        assert!(
            !storage
                .discard_mutation_with_shadow(
                    first,
                    claim.clone(),
                    OptimisticShadowReconciliation {
                        expected_queue: vec![first],
                        affected_keys: vec![key.clone()],
                        replacements: vec![],
                    },
                )
                .await
                .unwrap()
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 2);

        let reconciliation = OptimisticShadowReconciliation {
            expected_queue: vec![first, second],
            affected_keys: vec![key.clone()],
            replacements: vec![replacement.clone()],
        };
        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Discard,
            index: 0,
        });
        assert!(
            storage
                .discard_mutation_with_shadow(first, claim.clone(), reconciliation.clone())
                .await
                .is_err()
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 2);
        assert_eq!(
            storage
                .load_optimistic_projections(std::slice::from_ref(&key))
                .await
                .unwrap()
                .pop()
                .flatten(),
            Some(replacement)
        );

        assert!(
            storage
                .discard_mutation_with_shadow(first, claim, reconciliation)
                .await
                .unwrap()
        );
        assert_eq!(
            storage
                .load_mutation_queue()
                .await
                .unwrap()
                .iter()
                .map(|mutation| mutation.id)
                .collect::<Vec<_>>(),
            vec![second]
        );
        assert_eq!(
            storage
                .load_optimistic_projections(&[key])
                .await
                .unwrap()
                .pop()
                .flatten()
                .unwrap()
                .owner,
            second
        );
    });
}

#[test]
fn optimistic_shadow_hierarchy_enforces_unique_keys_owners_and_cascades() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("shadow-cascades").unwrap();
        let first = storage.enqueue_mutation(queued("First")).await.unwrap();
        let second = storage.enqueue_mutation(queued("Second")).await.unwrap();
        let connection = storage.connection();

        raw_execute(
            &storage,
            "INSERT INTO optimistic_index_documents (id, owner_mutation_id, record_key, profile, partition, state) VALUES (100, ?1, 'Thing:1', 'profile-v1', 'thing', 0)",
            vec![Value::from_i64(mutation_id_to_sql(second).unwrap())],
        );
        for (sql, parameters) in [
            (
                "INSERT INTO optimistic_exact_facts (document_id, attribute, value) VALUES (100, 'owner', ?1)",
                vec![Value::from_blob(b"user-1".to_vec())],
            ),
            (
                "INSERT INTO optimistic_integer_facts (document_id, attribute, value) VALUES (100, 'updated-at', 10)",
                vec![],
            ),
            (
                "INSERT INTO optimistic_sort_facts (document_id, attribute, value) VALUES (100, 'updated-at', 10)",
                vec![],
            ),
            (
                "INSERT INTO optimistic_uncertain_attributes (document_id, attribute) VALUES (100, 'file-type')",
                vec![],
            ),
        ] {
            raw_execute(&storage, sql, parameters);
        }
        assert!(
            driver::execute(
                &connection,
                "INSERT INTO optimistic_index_documents (owner_mutation_id, record_key, profile, partition, state) VALUES (?1, 'Thing:1', 'profile-v1', 'thing', 0)",
                vec![Value::from_i64(mutation_id_to_sql(second).unwrap())],
            )
            .is_err()
        );
        assert!(
            driver::execute(
                &connection,
                "INSERT INTO optimistic_index_documents (owner_mutation_id, record_key, profile, partition, state) VALUES (999, 'Thing:missing-owner', 'profile-v1', 'thing', 0)",
                vec![],
            )
            .is_err()
        );

        raw_execute(
            &storage,
            "DELETE FROM mutation_queue WHERE id = ?1",
            vec![Value::from_i64(mutation_id_to_sql(first).unwrap())],
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_index_documents"),
            1
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_exact_facts"),
            1
        );

        raw_execute(
            &storage,
            "DELETE FROM optimistic_index_documents WHERE id = 100",
            vec![],
        );
        for table in [
            "optimistic_exact_facts",
            "optimistic_integer_facts",
            "optimistic_sort_facts",
            "optimistic_uncertain_attributes",
        ] {
            assert_eq!(
                raw_scalar(&storage, &format!("SELECT COUNT(*) FROM {table}")),
                0
            );
        }

        raw_execute(
            &storage,
            "INSERT INTO optimistic_index_documents (id, owner_mutation_id, record_key, profile, partition, state) VALUES (101, ?1, 'Thing:2', 'profile-v1', 'thing', 1)",
            vec![Value::from_i64(mutation_id_to_sql(second).unwrap())],
        );
        raw_execute(
            &storage,
            "DELETE FROM mutation_queue WHERE id = ?1",
            vec![Value::from_i64(mutation_id_to_sql(second).unwrap())],
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM optimistic_index_documents"),
            0
        );
    });
}

#[test]
fn invalid_shadow_state_requests_reset_on_reopen() {
    let database = TursoMemoryDatabase::new("invalid-shadow-state.db");
    let mut storage = database.open("scope").unwrap();
    let owner = block_on(storage.enqueue_mutation(queued("Owner"))).unwrap();
    raw_execute(
        &storage,
        "INSERT INTO optimistic_index_documents (owner_mutation_id, record_key, profile, partition, state) VALUES (?1, 'Thing:1', 'profile-v1', 'thing', 99)",
        vec![Value::from_i64(mutation_id_to_sql(owner).unwrap())],
    );
    storage.try_close().unwrap();

    let error = database.open("scope").unwrap_err();
    assert_eq!(
        error.physical_reset_reason(),
        Some(PhysicalResetReason::Invariant)
    );
}

#[test]
fn quick_check_requires_exactly_one_ok_text_row() {
    assert!(validate_quick_check_rows(&[vec![text("ok")]]).is_ok());
    for rows in [
        Vec::new(),
        vec![vec![text("corrupt")]],
        vec![vec![text("ok")], vec![text("ok")]],
        vec![vec![text("ok"), text("extra")]],
        vec![vec![Value::from_i64(1)]],
    ] {
        assert_eq!(
            validate_quick_check_rows(&rows)
                .unwrap_err()
                .physical_reset_reason(),
            Some(PhysicalResetReason::Integrity)
        );
    }
}

#[test]
fn every_metadata_mismatch_and_missing_schema_requests_physical_reset() {
    block_on(async {
        for (name, sql) in [
            (
                "namespace",
                "UPDATE meta SET value = 'wrong' WHERE key = 'namespace'",
            ),
            (
                "scope",
                "UPDATE meta SET value = 'wrong' WHERE key = 'scope'",
            ),
            (
                "version",
                "UPDATE meta SET value = '999' WHERE key = 'storage_schema_version'",
            ),
            ("missing", "DELETE FROM meta WHERE key = 'namespace'"),
            ("schema", "DROP TABLE records"),
            (
                "queue-diagnostics-index",
                "DROP INDEX mutation_queue_created_at_ms_idx",
            ),
            ("search-table", "DROP TABLE search_documents"),
            ("search-index", "DROP INDEX search_documents_browse_idx"),
        ] {
            let database = TursoMemoryDatabase::new(format!("mismatch-{name}.db"));
            let storage = database.open("scope").unwrap();
            raw_execute(&storage, sql, Vec::new());
            storage.try_close().unwrap();
            let error = database.open("scope").unwrap_err();
            assert!(error.requires_physical_reset(), "case {name}: {error}");
            assert_eq!(
                error.physical_reset_reason(),
                Some(PhysicalResetReason::Compatibility)
            );
        }

        let database = TursoMemoryDatabase::new("scope-mismatch-reset.db");
        let mut storage = database.open("scope-a").unwrap();
        storage
            .put_batch(vec![(key("Thing:1"), record("value"))])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Queued")).await.unwrap();
        storage.try_close().unwrap();
        assert!(
            database
                .open("scope-b")
                .unwrap_err()
                .requires_physical_reset()
        );
        database.physical_reset();
        let storage = database.open("scope-b").unwrap();
        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![None]
        );
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    });
}

#[test]
fn semantically_equivalent_schema_formatting_is_accepted_on_reopen() {
    let database = TursoMemoryDatabase::new("semantic-schema-formatting.db");
    let storage = database.open("scope").unwrap();
    for sql in [
        "DROP TABLE optimistic_layers",
        "DROP TABLE mutation_queue",
        "DROP TABLE records",
        r#"create table [records] (
            [__typename] text not null,
            `id` text not null,
            'value' blob not null,
            -- UNIQUE(value), CHECK(id), and COLLATE NOCASE are only comment text.
            primary key ([__typename], `id`)
        )"#,
        r#"create table 'mutation_queue' (
            'id' integer /* AUTOINCREMENT UNIQUE CHECK COLLATE */ primary key autoincrement,
            "query" text not null,
            [operation_name] text,
            `variables_json` text not null,
            "identity" text,
            "attempt_count" integer default ( ( 0 ) ) not null,
            "next_attempt_at_ms" integer,
            "lease_owner" text,
            "lease_generation" integer default ((0)) not null,
            "lease_expires_at_ms" integer,
            "last_error" text,
            "created_at_ms" integer not null
        )"#,
        "CREATE INDEX mutation_queue_created_at_ms_idx ON mutation_queue(created_at_ms)",
        r#"create table `optimistic_layers` (
            `mutation_id` integer primary key,
            [optimistic_data_json] text not null,
            'normalized_updates' blob not null,
            /* A string-like quoted identifier containing 'UNIQUE CHECK COLLATE'. */
            foreign key (`mutation_id`) references 'mutation_queue' ('id') on delete cascade
        )"#,
    ] {
        raw_execute(&storage, sql, Vec::new());
    }
    assert_eq!(
        storage.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
    let mut reopened = database.open("scope").unwrap();
    block_on(async {
        let first = reopened.enqueue_mutation(queued("First")).await.unwrap();
        let claimed = reopened
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 2,
            })
            .await
            .unwrap()
            .unwrap();
        assert!(
            reopened
                .discard_mutation(first, token("runner", claimed.lease_generation))
                .await
                .unwrap()
        );
        assert!(reopened.enqueue_mutation(queued("Second")).await.unwrap() > first);
    });
    assert_eq!(
        reopened.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
}

#[test]
fn generated_column_forms_are_rejected_by_the_schema_lexer() {
    for sql in [
        "CREATE TABLE records (value TEXT GENERATED ALWAYS AS (id))",
        "CREATE TABLE records (value TEXT AS (id))",
    ] {
        let tokens = lex_schema(sql).unwrap();
        assert!(has_forbidden_table_syntax(&tokens), "SQL: {sql}");
    }
}

#[test]
fn every_malformed_frozen_schema_constraint_requests_reset_on_reopen() {
    let cases = vec![
        (
            "meta-primary-key",
            vec![
                "DROP TABLE meta",
                "CREATE TABLE meta (key TEXT, value TEXT NOT NULL)",
            ],
        ),
        (
            "meta-extra-foreign-key",
            vec![
                "DROP TABLE meta",
                "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, FOREIGN KEY (value) REFERENCES records(id))",
            ],
        ),
        (
            "records-column-type",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id INTEGER NOT NULL, value BLOB NOT NULL, PRIMARY KEY (__typename, id))",
            ],
        ),
        (
            "records-primary-key",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL)",
            ],
        ),
        (
            "records-primary-key-order",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (id, __typename))",
            ],
        ),
        (
            "records-not-null",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL, value BLOB, PRIMARY KEY (__typename, id))",
            ],
        ),
        (
            "records-extra-column",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL, extra TEXT, PRIMARY KEY (__typename, id))",
            ],
        ),
        (
            "records-extra-foreign-key",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (__typename, id), FOREIGN KEY (value) REFERENCES meta(key))",
            ],
        ),
        (
            "records-unique-constraint",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (__typename, id), UNIQUE (value))",
            ],
        ),
        (
            "records-check-constraint",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL CHECK (id <> ''), value BLOB NOT NULL, PRIMARY KEY (__typename, id))",
            ],
        ),
        (
            "records-collation",
            vec![
                "DROP TABLE records",
                "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT COLLATE NOCASE NOT NULL, value BLOB NOT NULL, PRIMARY KEY (__typename, id))",
            ],
        ),
        (
            "search-extra-column",
            vec![
                "DROP TABLE search_documents",
                "CREATE TABLE search_documents (profile TEXT NOT NULL, __typename TEXT NOT NULL, id TEXT NOT NULL, bucket TEXT NOT NULL, search_text TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, source_hash TEXT NOT NULL, extra TEXT, PRIMARY KEY (profile, __typename, id))",
                CREATE_SCHEMA[3],
            ],
        ),
        (
            "search-index-order",
            vec![
                "DROP INDEX search_documents_browse_idx",
                "CREATE INDEX search_documents_browse_idx ON search_documents(profile, timestamp_ms DESC, bucket, __typename, id)",
            ],
        ),
        (
            "queue-autoincrement",
            vec![
                "DROP TABLE optimistic_layers",
                "DROP TABLE mutation_queue",
                "CREATE TABLE mutation_queue (id INTEGER PRIMARY KEY, query TEXT NOT NULL, operation_name TEXT, variables_json TEXT NOT NULL, identity TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER, lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 0, lease_expires_at_ms INTEGER, last_error TEXT, created_at_ms INTEGER NOT NULL)",
                CREATE_SCHEMA[5],
            ],
        ),
        (
            "queue-extra-foreign-key",
            vec![
                "DROP TABLE optimistic_layers",
                "DROP TABLE mutation_queue",
                "CREATE TABLE mutation_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, operation_name TEXT, variables_json TEXT NOT NULL, identity TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER, lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 0, lease_expires_at_ms INTEGER, last_error TEXT, created_at_ms INTEGER NOT NULL, FOREIGN KEY (identity) REFERENCES meta(key))",
                CREATE_SCHEMA[5],
            ],
        ),
        (
            "queue-not-null",
            vec![
                "DROP TABLE optimistic_layers",
                "DROP TABLE mutation_queue",
                "CREATE TABLE mutation_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT, operation_name TEXT, variables_json TEXT NOT NULL, identity TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER, lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 0, lease_expires_at_ms INTEGER, last_error TEXT, created_at_ms INTEGER NOT NULL)",
                CREATE_SCHEMA[5],
            ],
        ),
        (
            "queue-default",
            vec![
                "DROP TABLE optimistic_layers",
                "DROP TABLE mutation_queue",
                "CREATE TABLE mutation_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, operation_name TEXT, variables_json TEXT NOT NULL, identity TEXT, attempt_count INTEGER NOT NULL DEFAULT 1, next_attempt_at_ms INTEGER, lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 0, lease_expires_at_ms INTEGER, last_error TEXT, created_at_ms INTEGER NOT NULL)",
                CREATE_SCHEMA[5],
            ],
        ),
        (
            "optimistic-primary-key",
            vec![
                "DROP TABLE optimistic_layers",
                "CREATE TABLE optimistic_layers (mutation_id INTEGER, optimistic_data_json TEXT NOT NULL, normalized_updates BLOB NOT NULL, FOREIGN KEY (mutation_id) REFERENCES mutation_queue(id) ON DELETE CASCADE)",
            ],
        ),
        (
            "optimistic-foreign-key",
            vec![
                "DROP TABLE optimistic_layers",
                "CREATE TABLE optimistic_layers (mutation_id INTEGER PRIMARY KEY, optimistic_data_json TEXT NOT NULL, normalized_updates BLOB NOT NULL)",
            ],
        ),
        (
            "optimistic-foreign-key-parent",
            vec![
                "DROP TABLE optimistic_layers",
                "CREATE TABLE optimistic_layers (mutation_id INTEGER PRIMARY KEY, optimistic_data_json TEXT NOT NULL, normalized_updates BLOB NOT NULL, FOREIGN KEY (mutation_id) REFERENCES records(id) ON DELETE CASCADE)",
            ],
        ),
        (
            "optimistic-foreign-key-from",
            vec![
                "DROP TABLE optimistic_layers",
                "CREATE TABLE optimistic_layers (mutation_id INTEGER PRIMARY KEY, optimistic_data_json TEXT NOT NULL, normalized_updates BLOB NOT NULL, FOREIGN KEY (optimistic_data_json) REFERENCES mutation_queue(id) ON DELETE CASCADE)",
            ],
        ),
        (
            "optimistic-foreign-key-to",
            vec![
                "DROP TABLE optimistic_layers",
                "CREATE TABLE optimistic_layers (mutation_id INTEGER PRIMARY KEY, optimistic_data_json TEXT NOT NULL, normalized_updates BLOB NOT NULL, FOREIGN KEY (mutation_id) REFERENCES mutation_queue(query) ON DELETE CASCADE)",
            ],
        ),
        (
            "optimistic-cascade",
            vec![
                "DROP TABLE optimistic_layers",
                "CREATE TABLE optimistic_layers (mutation_id INTEGER PRIMARY KEY, optimistic_data_json TEXT NOT NULL, normalized_updates BLOB NOT NULL, FOREIGN KEY (mutation_id) REFERENCES mutation_queue(id))",
            ],
        ),
        (
            "unexpected-table",
            vec!["CREATE TABLE unexpected_object (id INTEGER)"],
        ),
        (
            "unexpected-sequence-shaped-table",
            vec![
                "CREATE TABLE unexpected_sequence (value INTEGER PRIMARY KEY, is_called INTEGER, start INTEGER, inc INTEGER, min INTEGER, max INTEGER, cycle INTEGER)",
            ],
        ),
        (
            "unexpected-sqlite-sequence-shaped-table",
            vec!["CREATE TABLE unexpected_sqlite_sequence (name, seq)"],
        ),
        (
            "unexpected-index",
            vec!["CREATE INDEX records_value_index ON records(value)"],
        ),
        (
            "unexpected-unique-index",
            vec!["CREATE UNIQUE INDEX records_value_unique ON records(value)"],
        ),
        (
            "unexpected-partial-index",
            vec!["CREATE INDEX records_value_partial ON records(value) WHERE id <> ''"],
        ),
    ];

    for (name, statements) in cases {
        let database = TursoMemoryDatabase::new(format!("malformed-{name}.db"));
        let storage = database.open("scope").unwrap();
        for sql in statements {
            raw_execute(&storage, sql, Vec::new());
        }
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
        let error = database.open("scope").unwrap_err();
        assert_eq!(
            error.physical_reset_reason(),
            Some(PhysicalResetReason::Compatibility),
            "case {name}: {error}"
        );
        database.physical_reset();
    }
}

#[test]
fn corrupt_keys_blobs_queue_relationships_and_numerics_request_reset() {
    block_on(async {
        let storage = TursoStorage::open_in_memory("corrupt-record").unwrap();
        raw_execute(
            &storage,
            RECORD_UPSERT,
            vec![text("Thing"), text("1"), Value::from_blob(vec![0xff, 0x00])],
        );
        let error = storage.get_batch(&[key("Thing:1")]).await.unwrap_err();
        assert_eq!(
            error.physical_reset_reason(),
            Some(PhysicalResetReason::Codec)
        );

        let storage = TursoStorage::open_in_memory("missing-layer").unwrap();
        raw_execute(
            &storage,
            "INSERT INTO mutation_queue (query, variables_json, created_at_ms) VALUES (?1, ?2, ?3)",
            vec![
                text("mutation Missing { x }"),
                text("{}"),
                Value::from_i64(0),
            ],
        );
        assert_eq!(
            storage
                .load_mutation_queue()
                .await
                .unwrap_err()
                .physical_reset_reason(),
            Some(PhysicalResetReason::Invariant)
        );

        let storage = TursoStorage::open_in_memory("orphan-layer").unwrap();
        raw_execute(&storage, "PRAGMA foreign_keys = OFF", Vec::new());
        raw_execute(
            &storage,
            LAYER_INSERT,
            vec![
                Value::from_i64(999),
                text("{}"),
                Value::from_blob(encode_record_updates(&RecordUpdates::default())),
            ],
        );
        raw_execute(&storage, "PRAGMA foreign_keys = ON", Vec::new());
        assert_eq!(raw_scalar(&storage, "PRAGMA foreign_keys"), 1);
        assert_eq!(
            storage
                .load_mutation_queue()
                .await
                .unwrap_err()
                .physical_reset_reason(),
            Some(PhysicalResetReason::Invariant)
        );

        let mut storage = TursoStorage::open_in_memory("corrupt-updates").unwrap();
        let id = storage.enqueue_mutation(queued("Corrupt")).await.unwrap();
        raw_execute(
            &storage,
            "UPDATE optimistic_layers SET normalized_updates = ?2 WHERE mutation_id = ?1",
            vec![
                Value::from_i64(mutation_id_to_sql(id).unwrap()),
                Value::from_blob(vec![0xff]),
            ],
        );
        assert_eq!(
            storage
                .load_mutation_queue()
                .await
                .unwrap_err()
                .physical_reset_reason(),
            Some(PhysicalResetReason::Codec)
        );

        for (name, column, value) in [
            ("negative-attempt", "attempt_count", -1),
            ("large-attempt", "attempt_count", i64::from(u32::MAX) + 1),
            ("negative-generation", "lease_generation", -1),
        ] {
            let mut storage = TursoStorage::open_in_memory(name).unwrap();
            let id = storage.enqueue_mutation(queued(name)).await.unwrap();
            raw_execute(
                &storage,
                &format!("UPDATE mutation_queue SET {column} = ?2 WHERE id = ?1"),
                vec![
                    Value::from_i64(mutation_id_to_sql(id).unwrap()),
                    Value::from_i64(value),
                ],
            );
            assert_eq!(
                storage
                    .load_mutation_queue()
                    .await
                    .unwrap_err()
                    .physical_reset_reason(),
                Some(PhysicalResetReason::Invariant)
            );
        }

        for invalid_id in [0, -1] {
            let storage =
                TursoStorage::open_in_memory(&format!("invalid-id-{invalid_id}")).unwrap();
            raw_execute(
                &storage,
                "INSERT INTO mutation_queue (id, query, variables_json, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
                vec![
                    Value::from_i64(invalid_id),
                    text("mutation Invalid { x }"),
                    text("{}"),
                    Value::from_i64(0),
                ],
            );
            raw_execute(
                &storage,
                LAYER_INSERT,
                vec![
                    Value::from_i64(invalid_id),
                    text("{}"),
                    Value::from_blob(encode_record_updates(&RecordUpdates::default())),
                ],
            );
            assert_eq!(
                storage
                    .load_mutation_queue()
                    .await
                    .unwrap_err()
                    .physical_reset_reason(),
                Some(PhysicalResetReason::Invariant)
            );
        }

        let mut storage = TursoStorage::open_in_memory("generation-overflow").unwrap();
        let id = storage
            .enqueue_mutation(queued("GenerationOverflow"))
            .await
            .unwrap();
        raw_execute(
            &storage,
            "UPDATE mutation_queue SET lease_generation = ?2 WHERE id = ?1",
            vec![
                Value::from_i64(mutation_id_to_sql(id).unwrap()),
                Value::from_i64(i64::MAX),
            ],
        );
        assert_eq!(
            storage
                .claim_next_mutation(MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 1,
                    lease_expires_at_ms: 2,
                })
                .await
                .unwrap_err()
                .physical_reset_reason(),
            Some(PhysicalResetReason::Invariant)
        );
    });
}

#[test]
fn reset_health_latch_blocks_every_method_without_touching_turso() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("health-latch").unwrap();
        raw_execute(
            &storage,
            RECORD_UPSERT,
            vec![text("Thing"), text("1"), Value::from_blob(vec![0xff])],
        );
        expect_reset_reason(
            storage.get_batch(&[key("Thing:1")]).await,
            PhysicalResetReason::Codec,
        );

        driver::clear_control_trace();
        driver::arm_reset_failure(RECORD_GET);
        expect_every_storage_method_latched(&mut storage, PhysicalResetReason::Codec).await;
        assert!(driver::take_control_trace().is_empty());
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::ResetRequired(PhysicalResetReason::Codec)
        );

        // The reset fault remains armed, proving the latched get did not even
        // prepare/reset its Turso statement.
        let probe = TursoStorage::open_in_memory("health-latch-probe").unwrap();
        expect_reset_reason(
            probe.get_batch(&[key("Thing:1")]).await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert_eq!(
            probe.try_close().unwrap(),
            TursoStorageCloseOutcome::ResetRequired(
                PhysicalResetReason::TransactionOutcomeUncertain
            )
        );
    });
}

#[test]
fn statement_cleanup_failures_are_uncertain_and_begin_cleanup_attempts_rollback() {
    block_on(async {
        for (name, sql) in [("begin-reset", "BEGIN"), ("write-reset", RECORD_UPSERT)] {
            let database = TursoMemoryDatabase::new(format!("{name}.db"));
            let mut storage = database.open("scope").unwrap();
            driver::clear_control_trace();
            driver::arm_reset_failure(sql);
            expect_reset_reason(
                storage
                    .put_batch(vec![(key("Thing:1"), record("value"))])
                    .await,
                PhysicalResetReason::TransactionOutcomeUncertain,
            );
            assert_eq!(
                driver::take_control_trace(),
                vec![
                    driver::TestControlPhase::Begin,
                    driver::TestControlPhase::Rollback,
                ],
                "case {name}"
            );

            driver::clear_control_trace();
            expect_reset_reason(
                storage.get_batch(&[key("Thing:1")]).await,
                PhysicalResetReason::TransactionOutcomeUncertain,
            );
            assert!(driver::take_control_trace().is_empty(), "case {name}");
            assert_eq!(
                storage.try_close().unwrap(),
                TursoStorageCloseOutcome::ResetRequired(
                    PhysicalResetReason::TransactionOutcomeUncertain
                )
            );
            database.physical_reset();
            let replacement = database.open("scope").unwrap();
            assert_eq!(
                replacement.get_batch(&[key("Thing:1")]).await.unwrap(),
                vec![None]
            );
            assert_eq!(
                replacement.try_close().unwrap(),
                TursoStorageCloseOutcome::Healthy
            );
        }
    });
}

#[test]
fn completion_delivered_commit_failure_is_exact_and_not_reusable() {
    block_on(async {
        let io = FaultIo::new();
        let mut storage = fault_storage(io.clone());
        io.arm(IoFault::CommitCompletion);
        driver::clear_control_trace();
        expect_reset_reason(
            storage
                .put_batch(vec![(key("Thing:1"), record("value"))])
                .await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert!(io.is_clear(), "COMMIT did not observe its File completion");
        assert_eq!(
            driver::take_control_trace(),
            vec![
                driver::TestControlPhase::Begin,
                driver::TestControlPhase::Commit,
                driver::TestControlPhase::Rollback,
            ]
        );
        assert!(
            driver::take_control_io_trace().is_empty(),
            "the COMMIT Statement must observe the delivered completion directly"
        );

        driver::clear_control_trace();
        expect_reset_reason(
            storage.get_batch(&[key("Thing:1")]).await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert!(driver::take_control_trace().is_empty());
        assert!(driver::take_control_io_trace().is_empty());
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::ResetRequired(
                PhysicalResetReason::TransactionOutcomeUncertain
            )
        );
    });
}

#[test]
fn rollback_io_step_polling_failure_is_exact_and_not_reusable() {
    block_on(async {
        let io = FaultIo::new();
        let mut storage = fault_storage(io.clone());
        storage.arm_fault(TestFault::RollbackIoStepAfter {
            site: TestFaultSite::Put,
            index: 0,
            fault_state: io.fault.clone(),
            fault_code: IoFault::RollbackIoStep as u8,
        });
        driver::clear_control_trace();
        expect_reset_reason(
            storage
                .put_batch(vec![(key("Thing:1"), record("value"))])
                .await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert!(io.is_clear(), "ROLLBACK did not poll the injected IO error");
        assert_eq!(
            driver::take_control_trace(),
            vec![
                driver::TestControlPhase::Begin,
                driver::TestControlPhase::Rollback,
            ]
        );
        assert_eq!(
            driver::take_control_io_trace(),
            vec![driver::TestControlPhase::Rollback]
        );

        driver::clear_control_trace();
        expect_reset_reason(
            storage.get_batch(&[key("Thing:1")]).await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert!(driver::take_control_trace().is_empty());
        assert!(driver::take_control_io_trace().is_empty());
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::ResetRequired(
                PhysicalResetReason::TransactionOutcomeUncertain
            )
        );

        let replacement = fault_storage(FaultIo::new());
        assert_eq!(
            replacement.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![None]
        );
        assert!(replacement.load_mutation_queue().await.unwrap().is_empty());
        assert_eq!(
            replacement.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}

#[test]
fn operation_reset_classes_survive_successful_rollback_and_latching() {
    block_on(async {
        for reason in [PhysicalResetReason::StorageFull, PhysicalResetReason::Io] {
            let mut storage = TursoStorage::open_in_memory("preserved-reset-class").unwrap();
            storage.arm_fault(TestFault::ResetAfter {
                site: TestFaultSite::Put,
                index: 0,
                reason,
            });
            expect_reset_reason(
                storage
                    .put_batch(vec![(key("Thing:1"), record("value"))])
                    .await,
                reason,
            );
            expect_reset_reason(storage.get_batch(&[key("Thing:1")]).await, reason);
            assert_eq!(
                storage.try_close().unwrap(),
                TursoStorageCloseOutcome::ResetRequired(reason)
            );
        }
    });
}

#[test]
fn injected_statement_failures_roll_back_every_storage_boundary() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("atomic-put").unwrap();
        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Put,
            index: 0,
        });
        storage
            .put_batch(vec![
                (key("Thing:1"), record("one")),
                (key("Thing:2"), record("two")),
            ])
            .await
            .unwrap_err();
        assert_eq!(
            storage
                .get_batch(&[key("Thing:1"), key("Thing:2")])
                .await
                .unwrap(),
            vec![None, None]
        );

        storage
            .put_batch(vec![
                (key("Thing:1"), record("one")),
                (key("Thing:2"), record("two")),
            ])
            .await
            .unwrap();
        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Delete,
            index: 0,
        });
        storage
            .delete_batch(&[key("Thing:1"), key("Thing:2")])
            .await
            .unwrap_err();
        assert_eq!(
            storage
                .get_batch(&[key("Thing:1"), key("Thing:2")])
                .await
                .unwrap(),
            vec![Some(record("one")), Some(record("two"))]
        );

        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Enqueue,
            index: 0,
        });
        storage
            .enqueue_mutation(queued("Atomic"))
            .await
            .unwrap_err();
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());

        let id = storage.enqueue_mutation(queued("Complete")).await.unwrap();
        let claimed = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 10,
            })
            .await
            .unwrap()
            .unwrap();
        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Complete,
            index: 0,
        });
        storage
            .complete_mutation(
                id,
                token("runner", claimed.lease_generation),
                vec![
                    (key("Result:1"), record("one")),
                    (key("Result:2"), record("two")),
                ],
            )
            .await
            .unwrap_err();
        assert_eq!(
            storage
                .get_batch(&[key("Result:1"), key("Result:2")])
                .await
                .unwrap(),
            vec![None, None]
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 1);

        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Discard,
            index: 0,
        });
        storage
            .discard_mutation(id, token("runner", claimed.lease_generation))
            .await
            .unwrap_err();
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 1);

        storage.arm_fault(TestFault::After {
            site: TestFaultSite::Clear,
            index: 0,
        });
        storage.clear().await.unwrap_err();
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 1);
        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![Some(record("one"))]
        );
    });
}

#[test]
fn corruption_quota_io_and_uncertain_transactions_have_payload_free_classes() {
    assert_eq!(
        TursoStorageError::turso(LimboError::Corrupt("secret payload".into()))
            .physical_reset_reason(),
        Some(PhysicalResetReason::Corruption)
    );
    assert_eq!(
        TursoStorageError::turso(LimboError::DatabaseFull("secret payload".into()))
            .physical_reset_reason(),
        Some(PhysicalResetReason::StorageFull)
    );
    assert_eq!(
        TursoStorageError::turso(LimboError::CompletionError(CompletionError::IOError(
            std::io::ErrorKind::StorageFull,
            "write",
        )))
        .physical_reset_reason(),
        Some(PhysicalResetReason::StorageFull)
    );
    assert_eq!(
        TursoStorageError::turso(LimboError::CompletionError(CompletionError::IOError(
            std::io::ErrorKind::Other,
            "sync",
        )))
        .physical_reset_reason(),
        Some(PhysicalResetReason::Io)
    );
    let error = TursoStorageError::reset(PhysicalResetReason::TransactionOutcomeUncertain);
    assert!(!error.to_string().contains("secret"));
}

#[derive(Clone, Copy)]
#[repr(u8)]
enum IoFault {
    None = 0,
    StorageFull = 1,
    Sync = 2,
    CommitCompletion = 3,
    RollbackIoStep = 4,
}

struct FaultIo {
    inner: MemoryIO,
    fault: Arc<AtomicU8>,
}

impl FaultIo {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: MemoryIO::new(),
            fault: Arc::new(AtomicU8::new(IoFault::None as u8)),
        })
    }

    fn arm(&self, fault: IoFault) {
        self.fault.store(fault as u8, Ordering::SeqCst);
    }

    fn take(&self, fault: IoFault) -> bool {
        self.fault
            .compare_exchange(
                fault as u8,
                IoFault::None as u8,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    fn is_clear(&self) -> bool {
        self.fault.load(Ordering::SeqCst) == IoFault::None as u8
    }
}

impl Clock for FaultIo {
    fn current_time_monotonic(&self) -> MonotonicInstant {
        self.inner.current_time_monotonic()
    }

    fn current_time_wall_clock(&self) -> WallClockInstant {
        self.inner.current_time_wall_clock()
    }
}

impl IO for FaultIo {
    fn open_file(
        &self,
        path: &str,
        flags: OpenFlags,
        direct: bool,
    ) -> turso_core::Result<Arc<dyn File>> {
        Ok(Arc::new(FaultFile {
            fault: self.fault.clone(),
            inner: self.inner.open_file(path, flags, direct)?,
        }))
    }

    fn remove_file(&self, path: &str) -> turso_core::Result<()> {
        self.inner.remove_file(path)
    }

    fn file_id(&self, path: &str) -> turso_core::Result<FileId> {
        self.inner.file_id(path)
    }

    fn supports_shared_wal_coordination(&self) -> bool {
        false
    }

    fn step(&self) -> turso_core::Result<()> {
        if driver::current_test_control_phase() == Some(driver::TestControlPhase::Rollback)
            && self.take(IoFault::RollbackIoStep)
        {
            return Err(CompletionError::IOError(
                std::io::ErrorKind::Other,
                "rollback IO::step polling",
            )
            .into());
        }
        self.inner.step()
    }
}

struct FaultFile {
    fault: Arc<AtomicU8>,
    inner: Arc<dyn File>,
}

impl FaultFile {
    fn take(&self, fault: IoFault) -> bool {
        self.fault
            .compare_exchange(
                fault as u8,
                IoFault::None as u8,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    fn deliver_commit_completion_error(&self, completion: &Completion) -> bool {
        if driver::current_test_control_phase() != Some(driver::TestControlPhase::Commit)
            || !self.take(IoFault::CommitCompletion)
        {
            return false;
        }
        // Deliver the failure through the File completion before returning;
        // the COMMIT Statement observes that completion directly. This is not
        // an IO::step error and no successful operation is later reclassified.
        completion.error(CompletionError::IOError(
            std::io::ErrorKind::Other,
            "commit completion delivery",
        ));
        true
    }
}

impl File for FaultFile {
    fn lock_file(&self, exclusive: bool) -> turso_core::Result<()> {
        self.inner.lock_file(exclusive)
    }

    fn unlock_file(&self) -> turso_core::Result<()> {
        self.inner.unlock_file()
    }

    fn pread(&self, pos: u64, completion: Completion) -> turso_core::Result<Completion> {
        self.inner.pread(pos, completion)
    }

    fn pwrite(
        &self,
        pos: u64,
        buffer: Arc<Buffer>,
        completion: Completion,
    ) -> turso_core::Result<Completion> {
        if self.deliver_commit_completion_error(&completion) {
            return Ok(completion);
        }
        if self.take(IoFault::StorageFull) {
            return Err(CompletionError::IOError(std::io::ErrorKind::StorageFull, "write").into());
        }
        self.inner.pwrite(pos, buffer, completion)
    }

    fn pwritev(
        &self,
        pos: u64,
        buffers: Vec<Arc<Buffer>>,
        completion: Completion,
    ) -> turso_core::Result<Completion> {
        if self.deliver_commit_completion_error(&completion) {
            return Ok(completion);
        }
        if self.take(IoFault::StorageFull) {
            return Err(CompletionError::IOError(std::io::ErrorKind::StorageFull, "writev").into());
        }
        self.inner.pwritev(pos, buffers, completion)
    }

    fn sync(
        &self,
        completion: Completion,
        sync_type: FileSyncType,
    ) -> turso_core::Result<Completion> {
        if self.deliver_commit_completion_error(&completion) {
            return Ok(completion);
        }
        if self.take(IoFault::Sync) {
            return Err(CompletionError::IOError(std::io::ErrorKind::Other, "sync").into());
        }
        self.inner.sync(completion, sync_type)
    }

    fn size(&self) -> turso_core::Result<u64> {
        self.inner.size()
    }

    fn truncate(&self, len: u64, completion: Completion) -> turso_core::Result<Completion> {
        if self.deliver_commit_completion_error(&completion) {
            return Ok(completion);
        }
        self.inner.truncate(len, completion)
    }

    fn has_hole(&self, pos: usize, len: usize) -> turso_core::Result<bool> {
        self.inner.has_hole(pos, len)
    }

    fn punch_hole(&self, pos: usize, len: usize) -> turso_core::Result<()> {
        self.inner.punch_hole(pos, len)
    }
}

fn fault_storage(io: Arc<FaultIo>) -> TursoStorage {
    static NEXT_FAULT_DATABASE: AtomicU64 = AtomicU64::new(1);
    let id = NEXT_FAULT_DATABASE.fetch_add(1, Ordering::Relaxed);
    let path = format!("fault-{id}.db");
    let io_trait: Arc<dyn IO> = io;
    let database =
        Database::open(io_trait, &path, OpenOptions::new(Arc::new(SqliteDialect))).unwrap();
    let connection = database.connect().unwrap();
    initialize(&connection, "fault-scope", true).unwrap();
    TursoStorage {
        health: AtomicU8::new(0),
        database,
        connection,
        fault: Mutex::new(None),
    }
}

#[test]
fn predicate_query_plan_uses_fact_indexes_and_never_scans_record_blobs() {
    let storage = TursoStorage::open_in_memory("predicate-query-plan").unwrap();
    let token = |value| Token::new(value).unwrap();
    let query = ValidatedIndexQuery::new(predicate_index::IndexQuery {
        profile: Profile::new(token("soup-flat-v1")),
        partitions: vec![predicate_index::PartitionPredicate {
            partition: token("document"),
            predicate: PredicateExpr::And(
                Box::new(PredicateExpr::Exact {
                    attribute: token("owner"),
                    value: predicate_index::ExactValue::utf8("owner-1").unwrap(),
                }),
                Box::new(PredicateExpr::I64Range {
                    attribute: token("updated-at"),
                    lower: Some(RangeBound::Inclusive(10)),
                    upper: None,
                }),
            ),
        }],
        sort_attribute: token("updated-at"),
        sort_direction: SortDirection::Desc,
        tie_break_direction: SortDirection::Desc,
        limit: 20,
    })
    .unwrap();
    let (sql, parameters) = compile_predicate_sql(&query);
    let details = driver::query(
        &storage.connection(),
        &format!("EXPLAIN QUERY PLAN {sql}"),
        parameters,
    )
    .unwrap()
    .into_iter()
    .map(|row| required_text(&row, 3).unwrap())
    .collect::<Vec<_>>();
    assert!(
        details
            .iter()
            .any(|detail| detail.contains("exact_facts_lookup_idx")),
        "{details:#?}"
    );
    assert!(
        details
            .iter()
            .any(|detail| detail.contains("integer_facts_lookup_idx")),
        "{details:#?}"
    );
    for index in [
        "optimistic_exact_facts_lookup_idx",
        "optimistic_integer_facts_lookup_idx",
        "sort_facts_lookup_idx",
        "optimistic_sort_facts_lookup_idx",
    ] {
        assert!(
            details.iter().any(|detail| detail.contains(index)),
            "missing {index}: {details:#?}"
        );
    }
    assert!(details.iter().all(|detail| !detail.contains("records")));
    assert!(
        details
            .iter()
            .all(|detail| !detail.contains("mutation_queue"))
    );
}

#[test]
fn injected_memory_io_quota_and_sync_failures_require_reset() {
    block_on(async {
        for fault in [IoFault::StorageFull, IoFault::Sync] {
            // Both injected file failures are reached while COMMIT is in
            // flight, so the transaction outcome class takes precedence.
            let expected = PhysicalResetReason::TransactionOutcomeUncertain;
            let io = FaultIo::new();
            let mut storage = fault_storage(io.clone());
            io.arm(fault);
            expect_reset_reason(
                storage
                    .put_batch(vec![(key("Thing:1"), record("value"))])
                    .await,
                expected,
            );
            expect_reset_reason(storage.get_batch(&[key("Thing:1")]).await, expected);
            assert_eq!(
                storage.try_close().unwrap(),
                TursoStorageCloseOutcome::ResetRequired(expected)
            );
        }
    });
}
