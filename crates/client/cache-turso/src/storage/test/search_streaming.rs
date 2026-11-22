use super::*;

#[test]
fn borrowed_search_rows_reject_corrupt_shapes_before_visiting() {
    let storage = TursoStorage::open_in_memory("borrowed-row-validation").unwrap();
    let mut key_buffer = String::new();
    for sql in [
        "SELECT 'Thing', 'id', 'text', 0, 'hash', 1",
        "SELECT 'Thing', 'id', 'text', 0, 'hash', 1, 1, 'extra'",
        "SELECT 'Thing', 'id', 'text', 'invalid', 'hash', 1, 1",
        "SELECT '', 'id', 'text', 0, 'hash', 1, 1",
        "SELECT 'Thing:bad', 'id', 'text', 0, 'hash', 1, 1",
        "SELECT 'Thing', 'id', NULL, 0, 'hash', 1, 1",
        // A row of another slot or profile inside this slot's range.
        "SELECT 'Thing', 'id', 'text', 0, 'hash', 2, 1",
        "SELECT 'Thing', 'id', 'text', 0, 'hash', 1, 2",
    ] {
        let result = driver::query_each(&storage.connection(), sql, vec![], |row| {
            search::visit_row(
                row,
                SearchProfile::QuickAccessV1,
                "document",
                1,
                &SearchQuery::new(""),
                &mut key_buffer,
                &mut |_| panic!("corrupt row visited"),
            )
        });
        expect_reset_reason(result, PhysicalResetReason::Corruption);
    }
}

#[test]
fn streamed_queries_cleanup_after_a_visitor_failure() {
    let storage = TursoStorage::open_in_memory("stream-cleanup").unwrap();
    let connection = storage.connection();
    let mut visited = 0;
    let result = driver::query_each(&connection, "SELECT 1 UNION ALL SELECT 2", vec![], |_row| {
        visited += 1;
        Err(TursoStorageError::InvalidInput)
    });
    assert!(matches!(result, Err(TursoStorageError::InvalidInput)));
    assert_eq!(visited, 1);
    // Releasing the unfinished read must leave the connection usable.
    driver::execute(
        &connection,
        "INSERT INTO meta(key, value) VALUES ('after-stream', 'ok')",
        vec![],
    )
    .unwrap();
    assert_eq!(
        raw_scalar(
            &storage,
            "SELECT COUNT(*) FROM meta WHERE key = 'after-stream'"
        ),
        1
    );
}

#[test]
fn streamed_search_reset_failure_retires_storage_even_after_rows_were_visited() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("stream-reset-failure").unwrap();
        storage
            .put_batch(vec![(
                key("GraphqlSoupDocument:doc"),
                quick_access_document("needle", 1),
            )])
            .await
            .unwrap();
        let query = SearchQuery::new("ndl");
        let slot = search::find_slot(
            &storage.connection(),
            SearchProfile::QuickAccessV1,
            "document",
        )
        .unwrap()
        .unwrap();
        let (sql, _) = search::statement(slot).unwrap();
        driver::arm_reset_failure(&sql);
        let mut visited = 0;
        expect_reset_reason(
            storage
                .visit_search_documents(SearchProfile::QuickAccessV1, "document", &query, |_| {
                    visited += 1
                })
                .await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert_eq!(visited, 1);
        expect_reset_reason(
            storage.get_batch(&[key("GraphqlSoupDocument:doc")]).await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
    });
}
