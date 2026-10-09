use super::*;

fn budget_rows(storage: &TursoStorage) -> i64 {
    raw_scalar(
        storage,
        "SELECT COUNT(*) FROM meta WHERE key GLOB 'mutation-server-failures:*'",
    )
}

#[test]
fn retry_budget_is_removed_with_its_pending_mutation() {
    block_on(async {
        for mode in ["commit", "rollback", "replace", "clear"] {
            let database = TursoMemoryDatabase::new(format!("retry-cleanup-{mode}.db"));
            let mut storage = database.open("retry-cleanup").unwrap();
            let mut entry = queued("Pending");
            let uuid = entry.uuid;
            entry.mutation.server_failure_count = 9;
            let id = storage.enqueue_mutation(entry).await.unwrap();
            assert_eq!(budget_rows(&storage), 1);
            match mode {
                "replace" => {
                    let mut replacement = queued("Replacement");
                    replacement.uuid = uuid;
                    storage.enqueue_mutation(replacement).await.unwrap();
                    assert_eq!(
                        storage.load_mutation_queue().await.unwrap()[0]
                            .mutation
                            .server_failure_count,
                        0
                    );
                }
                "clear" => storage.clear().await.unwrap(),
                _ => {
                    let claim = storage
                        .claim_next_mutation(MutationClaimRequest {
                            owner: "runner".into(),
                            now_ms: 1,
                            lease_expires_at_ms: 2,
                        })
                        .await
                        .unwrap()
                        .unwrap();
                    assert_eq!(claim.queued.mutation.server_failure_count, 9);
                    let claim = token("runner", claim.lease_generation);
                    if mode == "commit" {
                        assert!(
                            storage
                                .complete_mutation(id, claim, Vec::new())
                                .await
                                .unwrap()
                        );
                    } else {
                        assert!(storage.discard_mutation(id, claim).await.unwrap());
                    }
                }
            }
            assert_eq!(budget_rows(&storage), 0, "{mode}");
            storage.try_close().unwrap();
        }
    });
}

#[test]
fn retry_budget_survives_file_reopen_without_a_schema_change() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("retry.db");
        let database = TursoFileDatabase::new(&path).unwrap();
        let mut storage = database.open("retry").unwrap();
        let id = storage
            .enqueue_mutation(queued("LegacyPending"))
            .await
            .unwrap();
        assert_eq!(budget_rows(&storage), 0);
        let claim = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "old-tab".into(),
                now_ms: 1,
                lease_expires_at_ms: 2,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claim.queued.mutation.server_failure_count, 0);
        assert!(
            storage
                .defer_mutation(
                    id,
                    token("old-tab", claim.lease_generation),
                    2,
                    "server failed".into(),
                    true
                )
                .await
                .unwrap()
        );
        storage.try_close().unwrap();
        drop(database);
        let database = TursoFileDatabase::new(path).unwrap();
        let mut storage = database.open("retry").unwrap();
        let claim = storage
            .claim_next_mutation(MutationClaimRequest {
                owner: "new-tab".into(),
                now_ms: 2,
                lease_expires_at_ms: 3,
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claim.queued.id, id);
        assert_eq!(claim.queued.mutation.attempt_count, 2);
        assert_eq!(claim.queued.mutation.server_failure_count, 1);
        assert!(
            storage
                .defer_mutation(
                    id,
                    token("new-tab", claim.lease_generation),
                    3,
                    "offline".into(),
                    false
                )
                .await
                .unwrap()
        );
        assert_eq!(
            storage.load_mutation_queue().await.unwrap()[0]
                .mutation
                .server_failure_count,
            1
        );
        storage.try_close().unwrap();
    });
}
