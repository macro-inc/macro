use super::*;
use cache_core::engine::Engine;
use cache_core::search::{SearchRequest, compare_recent};
use cache_core::value::{CacheNumber, CacheValue};

fn channel(viewed_at: u64, updated_at: u64) -> Record {
    Record {
        fields: [
            (
                "__typename".into(),
                CacheValue::String("GraphqlSoupChannel".into()),
            ),
            ("name".into(), CacheValue::String("Channel".into())),
            (
                "viewedAt".into(),
                CacheValue::Number(CacheNumber::PosInt(viewed_at)),
            ),
            (
                "updatedAt".into(),
                CacheValue::Number(CacheNumber::PosInt(updated_at)),
            ),
        ]
        .into(),
    }
}

#[test]
fn viewed_first_browse_order_is_applied_before_the_page_limit() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("viewed-first-pages").unwrap();
        let mut entries = (0..50)
            .map(|index| {
                (
                    key(&format!("GraphqlSoupChannel:{index:02}")),
                    channel(1, 3),
                )
            })
            .collect::<Vec<_>>();
        entries.push((key("GraphqlSoupChannel:recently-viewed"), channel(2, 2)));
        storage.put_batch(entries).await.unwrap();
        let mut engine = Engine::new(storage);
        let mut request = SearchRequest {
            profile: SearchProfile::QuickAccessV1,
            buckets: vec!["channel".into()],
            query: String::new(),
            cursor: None,
            limit: 50,
            now_ms: 3,
        };
        let first = engine.search(&request).await.unwrap();
        assert_eq!(first.documents.len(), 50);
        assert_eq!(
            first.documents[0].record_key.as_ref(),
            "GraphqlSoupChannel:recently-viewed"
        );
        request.cursor = first.next_cursor;
        assert!(request.cursor.is_some());
        let second = engine.search(&request).await.unwrap();
        assert_eq!(second.documents.len(), 1);
        assert!(second.next_cursor.is_none());
        let rows = first
            .documents
            .into_iter()
            .chain(second.documents)
            .collect::<Vec<_>>();
        assert!(
            rows.windows(2)
                .all(|rows| !compare_recent(&rows[0], &rows[1]).is_gt())
        );
    });
}

#[test]
fn reopen_rebuilds_old_search_rows_once_without_replacing_durable_data() {
    block_on(async {
        for old_version in [None, Some("1")] {
            let database =
                TursoMemoryDatabase::new(format!("projection-upgrade-{old_version:?}.db"));
            let mut storage = database.open("scope").unwrap();
            // More than two batches, with keys crossing a typename boundary.
            let mut entries = (0..600)
                .map(|index| {
                    (
                        key(&format!("GraphqlSoupChannel:{index:03}")),
                        channel(1, 3),
                    )
                })
                .collect::<Vec<_>>();
            entries.push((key("GraphqlSoupChannel:recently-viewed"), channel(2, 2)));
            entries.push((
                key("GraphqlSoupDocument:document"),
                quick_access_document("Document", 2),
            ));
            entries.push((key("Thing:retained"), record("unchanged")));
            storage.put_batch(entries.clone()).await.unwrap();
            storage.enqueue_mutation(queued("Pending")).await.unwrap();
            let pending = storage.load_mutation_queue().await.unwrap();
            let mut engine = Engine::new(storage);
            let generation = engine.current_storage_generation().await.unwrap();
            let storage = engine.into_storage();
            // Model rows written by the previous max(viewedAt, updatedAt) projection.
            raw_execute(
                &storage,
                "UPDATE search_documents SET timestamp_ms = 3 WHERE __typename = 'GraphqlSoupChannel'",
                vec![],
            );
            raw_execute(
                &storage,
                "DELETE FROM meta WHERE key = 'quick_access_projection_version'",
                vec![],
            );
            if let Some(version) = old_version {
                raw_execute(
                    &storage,
                    "INSERT INTO meta (key, value) VALUES ('quick_access_projection_version', ?1)",
                    vec![text(version)],
                );
            }
            storage.try_close().unwrap();

            let mut storage = database.open("scope").unwrap();
            let rows = storage
                .load_search_documents(SearchProfile::QuickAccessV1)
                .await
                .unwrap();
            assert_eq!(rows.len(), 602);
            assert_eq!(rows.iter().filter(|row| row.timestamp_ms == 1).count(), 600);
            assert_eq!(
                storage
                    .get_batch(
                        &entries
                            .iter()
                            .map(|(key, _)| key.clone())
                            .collect::<Vec<_>>()
                    )
                    .await
                    .unwrap(),
                entries
                    .iter()
                    .map(|(_, record)| Some(record.clone()))
                    .collect::<Vec<_>>()
            );
            assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
            let mut engine = Engine::new(storage);
            assert_eq!(
                engine.current_storage_generation().await.unwrap(),
                generation
            );
            storage = engine.into_storage();
            storage.try_close().unwrap();

            // A normal subsequent reopen must not scan or decode the corpus.
            driver::arm_reset_failure(SEARCH_REBUILD_RECORDS);
            let storage = database.open("scope").unwrap();
            assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
            expect_reset_reason(
                driver::query(
                    &storage.connection(),
                    SEARCH_REBUILD_RECORDS,
                    vec![text("GraphqlSoupChannel"), Value::from_i64(1)],
                ),
                PhysicalResetReason::TransactionOutcomeUncertain,
            );
            storage.try_close().unwrap();
        }
    });
}

#[test]
fn projection_rebuild_rolls_back_search_rows_and_version_on_failure() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("projection-upgrade-failure").unwrap();
        storage
            .put_batch(vec![(key("GraphqlSoupChannel:channel"), channel(1, 3))])
            .await
            .unwrap();
        raw_execute(
            &storage,
            "UPDATE search_documents SET timestamp_ms = 3",
            vec![],
        );
        raw_execute(
            &storage,
            "UPDATE meta SET value = '1' WHERE key = 'quick_access_projection_version'",
            vec![],
        );
        let before = storage
            .load_search_documents(SearchProfile::QuickAccessV1)
            .await
            .unwrap();
        // Fail after the DELETE has executed; the enclosing transaction must
        // retain the complete previous projection and its previous version.
        driver::arm_reset_failure(SEARCH_REBUILD_RECORDS);
        expect_reset_reason(
            ensure_search_projection_version(&storage.connection()),
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert_eq!(
            storage
                .load_search_documents(SearchProfile::QuickAccessV1)
                .await
                .unwrap(),
            before
        );
        assert_eq!(
            raw_scalar(
                &storage,
                "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'quick_access_projection_version'"
            ),
            1
        );
        ensure_search_projection_version(&storage.connection()).unwrap();
        assert_eq!(
            storage
                .load_search_documents(SearchProfile::QuickAccessV1)
                .await
                .unwrap()[0]
                .timestamp_ms,
            1
        );
    });
}

#[test]
fn projection_rebuild_seeks_past_earlier_rows_instead_of_scanning_them() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("projection-upgrade-cost").unwrap();
        storage
            .put_batch(
                (0..2_000)
                    .map(|index| {
                        (
                            key(&format!("GraphqlSoupChannel:{index:04}")),
                            channel(1, 3),
                        )
                    })
                    .collect(),
            )
            .await
            .unwrap();
        let mut statement =
            driver::prepare(&storage.connection(), SEARCH_REBUILD_RECORDS_AFTER).unwrap();
        let rows = driver::query_prepared(
            &mut statement,
            vec![
                text("GraphqlSoupChannel"),
                text("1989"),
                Value::from_i64(10),
            ],
        )
        .unwrap();
        assert_eq!(rows.len(), 10);
        assert_eq!(required_text(&rows[0], 0).unwrap(), "1990");
        assert!(
            statement.metrics().vm_steps < 500,
            "late rebuild batch took {} VM steps",
            statement.metrics().vm_steps
        );
    });
}
