use super::*;

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
        let (sql, _) = search::statement(SearchProfile::QuickAccessV1, "document", &query);
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
