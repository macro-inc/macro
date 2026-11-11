use super::*;

#[test]
fn text_catalog_loads_use_the_bucket_index_without_touching_unrelated_rows() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("search-bucket-cost").unwrap();
        storage
            .put_batch(
                (0..3)
                    .map(|n| {
                        (
                            key(&format!("GraphqlSoupDocument:{n}")),
                            quick_access_document("needle", n),
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
            let mut statement = driver::prepare(&storage.connection(), SEARCH_LOAD).unwrap();
            let rows = driver::query_prepared(
                &mut statement,
                vec![
                    text(SearchProfile::QuickAccessV1.as_str()),
                    text("document"),
                ],
            )
            .unwrap();
            assert_eq!(rows.len(), 3);
            assert!(
                statement.metrics().vm_steps < 500,
                "{} VM steps with {unrelated_count} unrelated rows",
                statement.metrics().vm_steps
            );
            let documents = storage
                .load_search_documents(SearchProfile::QuickAccessV1, "document")
                .await
                .unwrap();
            assert_eq!(documents.len(), 3);
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
