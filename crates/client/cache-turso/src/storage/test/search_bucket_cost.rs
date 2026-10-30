use super::*;

#[test]
fn text_search_filters_in_sql_and_uses_the_bucket_index() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("search-bucket-cost").unwrap();
        storage
            .put_batch(
                (0..3)
                    .map(|n| {
                        (
                            key(&format!("GraphqlSoupDocument:{n}")),
                            quick_access_document(if n == 0 { "needle" } else { "other" }, n),
                        )
                    })
                    .collect(),
            )
            .await
            .unwrap();
        for unrelated_count in [0, 5_000] {
            storage
                .put_batch(
                    (0..unrelated_count)
                        .map(|n| {
                            let mut record = quick_access_document("needle mail", n);
                            record.fields.insert(
                                "__typename".into(),
                                cache_core::value::CacheValue::String(
                                    "GraphqlSoupEmailThread".into(),
                                ),
                            );
                            (key(&format!("GraphqlSoupEmailThread:{n}")), record)
                        })
                        .collect(),
                )
                .await
                .unwrap();
            let query = SearchQuery::new("ndl");
            let (sql, parameters) =
                search::statement(SearchProfile::QuickAccessV1, "document", &query);
            let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
            let rows = driver::query_prepared(&mut statement, parameters).unwrap();
            assert_eq!(rows.len(), 1);
            assert!(
                statement.metrics().vm_steps < 500,
                "{} VM steps with {unrelated_count} unrelated rows",
                statement.metrics().vm_steps
            );
            let mut documents = Vec::new();
            storage
                .visit_search_documents(SearchProfile::QuickAccessV1, "document", &query, |row| {
                    documents.push(row)
                })
                .await
                .unwrap();
            assert_eq!(documents.len(), 1);
            assert!(
                documents
                    .iter()
                    .all(|document| document.bucket == "document")
            );
        }
        assert!(
            storage
                .load_search_documents(SearchProfile::QuickAccessV1, "note")
                .await
                .unwrap()
                .is_empty()
        );
        // Bucket text is bound, never interpolated into SQL.
        assert!(
            storage
                .load_search_documents(SearchProfile::QuickAccessV1, "document' OR 1=1 --")
                .await
                .unwrap()
                .is_empty()
        );
    });
}
