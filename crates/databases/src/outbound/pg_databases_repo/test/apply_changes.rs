use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn link_to_a_concurrently_deleted_endpoint_conflicts_and_rolls_back_insert(pool: PgPool) {
    let (repo, source, definition) = fixture(&pool).await;
    let target = another_database_table(&repo).await;
    let link_definition = insert_definition(&pool, "Related").await;
    let column_id = repo
        .create_column(
            source.id,
            link_definition,
            &CreateColumn {
                table_id: source.id,
                binding: ColumnBinding::ExistingDefinition(link_definition),
                config: Some(ColumnConfig::Link {
                    database_id: target.database_id,
                    table_id: target.id,
                }),
                infer_type: false,
            },
        )
        .await
        .unwrap();
    let source_row = macro_uuid::generate_uuid_v7();
    let target_row = macro_uuid::generate_uuid_v7();
    repo.apply_changes(
        &viewer(),
        &[
            RowChange::Insert {
                table_id: source.id,
                row_id: source_row,
                cells: HashMap::new(),
            },
            RowChange::Insert {
                table_id: target.id,
                row_id: target_row,
                cells: HashMap::new(),
            },
        ],
        &HashMap::new(),
    )
    .await
    .unwrap()
    .applied()
    .unwrap();

    // Each caller's materialized link endpoint becomes stale before its write.
    for (deleted_table, deleted_row) in [(target.id, target_row), (source.id, source_row)] {
        repo.apply_changes(
            &viewer(),
            &[RowChange::Delete {
                table_id: deleted_table,
                row_id: deleted_row,
            }],
            &HashMap::new(),
        )
        .await
        .unwrap()
        .applied()
        .unwrap();
        let before = repo.table_versions(&[source.id, target.id]).await.unwrap();
        let source_count = repo.fetch_rows(source.id, 100).await.unwrap().len();
        let result = repo
            .apply_changes(
                &viewer(),
                &[
                    RowChange::Insert {
                        table_id: source.id,
                        row_id: macro_uuid::generate_uuid_v7(),
                        cells: cells(vec![(definition, text("must roll back"))]),
                    },
                    RowChange::Link {
                        column_id,
                        source_row_id: source_row,
                        target_row_id: target_row,
                    },
                ],
                &HashMap::new(),
            )
            .await
            .unwrap();
        assert_eq!(
            result,
            ApplyOutcome::VersionConflict {
                table_id: deleted_table
            }
        );
        assert_eq!(
            repo.fetch_rows(source.id, 100).await.unwrap().len(),
            source_count
        );
        assert!(repo.fetch_links(column_id).await.unwrap().is_empty());
        assert_eq!(
            repo.table_versions(&[source.id, target.id]).await.unwrap(),
            before
        );
        // Restore this endpoint so the next case isolates the other FK.
        repo.apply_changes(
            &viewer(),
            &[RowChange::Insert {
                table_id: deleted_table,
                row_id: deleted_row,
                cells: HashMap::new(),
            }],
            &HashMap::new(),
        )
        .await
        .unwrap()
        .applied()
        .unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn allocated_rows_and_edges_commit_together_or_roll_back_together(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let link_definition = insert_definition(&pool, "Related").await;
    let column_id = repo
        .create_column(
            table.id,
            link_definition,
            &CreateColumn {
                table_id: table.id,
                binding: ColumnBinding::ExistingDefinition(link_definition),
                config: Some(ColumnConfig::Link {
                    database_id: table.database_id,
                    table_id: table.id,
                }),
                infer_type: false,
            },
        )
        .await
        .unwrap();
    let source = macro_uuid::generate_uuid_v7();
    let target = macro_uuid::generate_uuid_v7();
    let batch = [
        RowChange::Insert {
            row_id: source,
            table_id: table.id,
            cells: cells(vec![(definition_id, text("source"))]),
        },
        RowChange::Insert {
            row_id: target,
            table_id: table.id,
            cells: cells(vec![(definition_id, text("target"))]),
        },
        RowChange::Link {
            column_id,
            source_row_id: source,
            target_row_id: target,
        },
        RowChange::Delete {
            table_id: table.id,
            row_id: macro_uuid::generate_uuid_v7(),
        },
    ];
    let snapshot = repo.table_versions(&[table.id]).await.unwrap();
    let rejected = repo
        .apply_changes(&viewer(), &batch, &snapshot)
        .await
        .unwrap();
    assert_eq!(
        rejected,
        ApplyOutcome::VersionConflict { table_id: table.id }
    );
    assert!(repo.fetch_rows(table.id, 100).await.unwrap().is_empty());
    assert!(repo.fetch_links(column_id).await.unwrap().is_empty());
    assert_eq!(repo.table_versions(&[table.id]).await.unwrap(), snapshot);

    let (ids, versions) = repo
        .apply_changes(&viewer(), &batch[..3], &snapshot)
        .await
        .unwrap()
        .applied()
        .unwrap();
    assert_eq!(ids, vec![source, target]);
    assert_eq!(
        repo.fetch_links(column_id).await.unwrap(),
        vec![(source, target)]
    );
    assert_eq!(versions[&table.id], TableVersion(snapshot[&table.id].0 + 1));
}

async fn another_database_table(repo: &PgDatabasesRepo) -> Table {
    let database = repo
        .create_database(
            &CreateDatabase {
                name: "Other database".into(),
                owner_id: user(),
            },
            "Table 1",
        )
        .await
        .unwrap();
    repo.get_database(database.id)
        .await
        .unwrap()
        .unwrap()
        .1
        .remove(0)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_row_update_and_delete_roll_back_earlier_inserts(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let missing = macro_uuid::generate_uuid_v7();
    let before = repo.table_versions(&[table.id]).await.unwrap();

    for change in [
        RowChange::Update {
            table_id: table.id,
            row_id: missing,
            cells: HashMap::from([(definition_id, Some(text("missing")))]),
        },
        RowChange::Delete {
            table_id: table.id,
            row_id: missing,
        },
    ] {
        let outcome = repo
            .apply_changes(
                &viewer(),
                &[
                    RowChange::Insert {
                        row_id: Uuid::now_v7(),
                        table_id: table.id,
                        cells: cells(vec![(definition_id, text("must roll back"))]),
                    },
                    change,
                ],
                &HashMap::new(),
            )
            .await
            .unwrap();

        assert_eq!(
            outcome,
            ApplyOutcome::VersionConflict { table_id: table.id }
        );
        assert!(repo.fetch_rows(table.id, 100).await.unwrap().is_empty());
        assert_eq!(repo.table_versions(&[table.id]).await.unwrap(), before);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn row_in_another_table_conflicts_without_mutating_either_table(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let other = another_database_table(&repo).await;
    let (inserted, _) = repo
        .apply_changes(
            &viewer(),
            &[RowChange::Insert {
                row_id: Uuid::now_v7(),
                table_id: table.id,
                cells: cells(vec![(definition_id, text("keep"))]),
            }],
            &HashMap::new(),
        )
        .await
        .unwrap()
        .applied()
        .unwrap();
    let before = repo.table_versions(&[table.id, other.id]).await.unwrap();

    for change in [
        RowChange::Update {
            table_id: other.id,
            row_id: inserted[0],
            cells: HashMap::new(),
        },
        RowChange::Delete {
            table_id: other.id,
            row_id: inserted[0],
        },
    ] {
        let outcome = repo
            .apply_changes(&viewer(), &[change], &HashMap::new())
            .await
            .unwrap();
        assert_eq!(
            outcome,
            ApplyOutcome::VersionConflict { table_id: other.id }
        );
        let rows = repo.fetch_rows(table.id, 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, inserted[0]);
        assert_eq!(
            rows[0].cells[&definition_id],
            PropertyValue::Str("keep".into())
        );
        assert!(repo.fetch_rows(other.id, 100).await.unwrap().is_empty());
        assert_eq!(
            repo.table_versions(&[table.id, other.id]).await.unwrap(),
            before
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn trash_after_snapshot_rejects_all_row_writes_and_preserves_the_batch(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let live = another_database_table(&repo).await;
    let (inserted, _) = repo
        .apply_changes(
            &viewer(),
            &[RowChange::Insert {
                row_id: Uuid::now_v7(),
                table_id: table.id,
                cells: cells(vec![(definition_id, text("keep"))]),
            }],
            &HashMap::new(),
        )
        .await
        .unwrap()
        .applied()
        .unwrap();
    let snapshot = repo.table_versions(&[table.id, live.id]).await.unwrap();
    repo.trash_database(table.database_id, chrono::Utc::now())
        .await
        .unwrap();

    for change in [
        RowChange::Insert {
            row_id: Uuid::now_v7(),
            table_id: table.id,
            cells: cells(vec![(definition_id, text("new"))]),
        },
        RowChange::Update {
            table_id: table.id,
            row_id: inserted[0],
            cells: HashMap::from([(definition_id, Some(text("changed")))]),
        },
        RowChange::Delete {
            table_id: table.id,
            row_id: inserted[0],
        },
    ] {
        let outcome = repo
            .apply_changes(
                &viewer(),
                &[
                    RowChange::Insert {
                        row_id: Uuid::now_v7(),
                        table_id: live.id,
                        cells: HashMap::new(),
                    },
                    change,
                ],
                &snapshot,
            )
            .await
            .unwrap();
        assert_eq!(
            outcome,
            ApplyOutcome::VersionConflict { table_id: table.id }
        );
        let rows = repo.fetch_rows(table.id, 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, inserted[0]);
        assert_eq!(
            rows[0].cells[&definition_id],
            PropertyValue::Str("keep".into())
        );
        assert!(repo.fetch_rows(live.id, 100).await.unwrap().is_empty());
        assert_eq!(
            repo.table_versions(&[table.id, live.id]).await.unwrap(),
            snapshot
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn trash_at_either_link_endpoint_rejects_link_and_unlink(pool: PgPool) {
    let (repo, source, _) = fixture(&pool).await;
    let target = another_database_table(&repo).await;
    let definition_id = insert_definition(&pool, "Related").await;
    let column_id = repo
        .create_column(
            source.id,
            definition_id,
            &CreateColumn {
                table_id: source.id,
                binding: ColumnBinding::ExistingDefinition(definition_id),
                config: Some(ColumnConfig::Link {
                    database_id: target.database_id,
                    table_id: target.id,
                }),
                infer_type: false,
            },
        )
        .await
        .unwrap();
    let (rows, _) = repo
        .apply_changes(
            &viewer(),
            &[source.id, source.id, target.id].map(|table_id| RowChange::Insert {
                row_id: Uuid::now_v7(),
                table_id,
                cells: HashMap::new(),
            }),
            &HashMap::new(),
        )
        .await
        .unwrap()
        .applied()
        .unwrap();
    repo.apply_changes(
        &viewer(),
        &[RowChange::Link {
            column_id,
            source_row_id: rows[0],
            target_row_id: rows[2],
        }],
        &HashMap::new(),
    )
    .await
    .unwrap()
    .applied()
    .unwrap();
    let snapshot = repo.table_versions(&[source.id, target.id]).await.unwrap();

    for trashed in [&source, &target] {
        repo.trash_database(trashed.database_id, chrono::Utc::now())
            .await
            .unwrap();
        for change in [
            RowChange::Link {
                column_id,
                source_row_id: rows[1],
                target_row_id: rows[2],
            },
            RowChange::Unlink {
                column_id,
                source_row_id: rows[0],
                target_row_id: rows[2],
            },
        ] {
            let outcome = repo
                .apply_changes(&viewer(), &[change], &snapshot)
                .await
                .unwrap();
            assert_eq!(
                outcome,
                ApplyOutcome::VersionConflict {
                    table_id: trashed.id
                }
            );
            assert_eq!(
                repo.fetch_links(column_id).await.unwrap(),
                vec![(rows[0], rows[2])]
            );
            assert_eq!(
                repo.table_versions(&[source.id, target.id]).await.unwrap(),
                snapshot
            );
        }
        repo.restore_database(trashed.database_id).await.unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn write_waits_for_inflight_trash_then_rejects_the_changed_database(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let snapshot = repo.table_versions(&[table.id]).await.unwrap();
    let mut trash = pool.begin().await.unwrap();
    let locker_pid = sqlx::query_scalar!(r#"SELECT pg_backend_pid() AS "pid!""#)
        .fetch_one(&mut *trash)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE databases SET trashed_at = now() WHERE id = $1",
        table.database_id,
    )
    .execute(&mut *trash)
    .await
    .unwrap();

    let writer = repo.clone();
    let expected = snapshot.clone();
    let write = tokio::spawn(async move {
        writer
            .apply_changes(
                &viewer(),
                &[RowChange::Insert {
                    row_id: Uuid::now_v7(),
                    table_id: table.id,
                    cells: cells(vec![(definition_id, text("must not appear"))]),
                }],
                &expected,
            )
            .await
    });

    // Observe a real database lock wait instead of assuming a task has started
    // after an arbitrary delay. This test database isolates the waiter.
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut poll = tokio::time::interval(std::time::Duration::from_millis(10));
        loop {
            assert!(
                !write.is_finished(),
                "the write must wait for the database lock"
            );
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND $1 = ANY(pg_blocking_pids(pid))
                ) AS "waiting!""#,
                locker_pid,
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting {
                break;
            }
            poll.tick().await;
        }
    })
    .await
    .expect("the row write should block behind the uncommitted trash");

    trash.commit().await.unwrap();
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(10), write)
        .await
        .expect("the write should finish after the database lock is released")
        .unwrap()
        .unwrap();
    assert_eq!(
        outcome,
        ApplyOutcome::VersionConflict { table_id: table.id }
    );
    assert!(repo.fetch_rows(table.id, 100).await.unwrap().is_empty());
    assert_eq!(repo.table_versions(&[table.id]).await.unwrap(), snapshot);
}
