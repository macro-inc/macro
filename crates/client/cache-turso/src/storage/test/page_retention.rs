use super::*;
use cache_core::page_retention::{MAX_SOUP_PAGE_BYTES, MAX_SOUP_PAGES};
use cache_core::value::CacheValue;

#[test]
fn legacy_page_compaction_preserves_entities_generation_queue_and_shadows() {
    block_on(async {
        let db = TursoMemoryDatabase::new("legacy-page-compaction.db");
        let mut storage = db.open("scope").unwrap();
        let mut viewer = Record::default();
        viewer.fields.insert(
            "__typename".into(),
            CacheValue::String("GraphqlUser".into()),
        );
        viewer
            .fields
            .insert("id".into(), CacheValue::String("viewer".into()));
        viewer.fields.insert(
            "emailLinks".into(),
            CacheValue::List(vec![CacheValue::Ref(key("EmailLink:one"))]),
        );
        for n in 0..5000 {
            viewer.fields.insert(
                format!("soup({{\"input\":{{\"continuation\":{{\"cursor\":\"{n}\"}}}}}})"),
                CacheValue::String("x".repeat(1024)),
            );
        }
        let mut engine = cache_core::engine::Engine::new(storage);
        let generation = engine.current_storage_generation().await.unwrap();
        storage = engine.into_storage();
        storage
            .put_batch(vec![
                (key("GraphqlUser:viewer"), viewer.clone()),
                (key("Thing:1"), record("entity")),
            ])
            .await
            .unwrap();
        storage
            .enqueue_mutation_with_shadow(
                queued("Pending"),
                vec![pending_projection("Thing:1", "owner", 10)],
            )
            .await
            .unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        let shadow_keys = [PredicateRecordKey::new("Thing:1").unwrap()];
        let shadows = storage
            .load_optimistic_projections(&shadow_keys)
            .await
            .unwrap();
        driver::execute(
            &storage.connection(),
            "DELETE FROM meta WHERE key = 'soup_page_retention_version'",
            vec![],
        )
        .unwrap();
        storage.try_close().unwrap();

        let storage = db.open("scope").unwrap();
        let compacted = storage
            .get_batch(&[key("GraphqlUser:viewer")])
            .await
            .unwrap()
            .remove(0)
            .unwrap();
        assert!(encode_record(&compacted).len() < MAX_SOUP_PAGE_BYTES);
        assert_eq!(
            compacted
                .fields
                .keys()
                .filter(|key| key.starts_with("soup("))
                .count(),
            MAX_SOUP_PAGES
        );
        assert_eq!(compacted.fields["emailLinks"], viewer.fields["emailLinks"]);
        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![Some(record("entity"))]
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        assert_eq!(
            storage
                .load_optimistic_projections(&shadow_keys)
                .await
                .unwrap(),
            shadows
        );
        let mut engine = cache_core::engine::Engine::new(storage);
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            generation
        );
        engine.into_storage().try_close().unwrap();

        // Completed compaction is metadata-only on subsequent opens: do not
        // scan even viewer records again, much less all normalized entities.
        driver::arm_reset_failure(SEARCH_REBUILD_RECORDS);
        let storage = db.open("scope").unwrap();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        assert!(
            driver::query(
                &storage.connection(),
                SEARCH_REBUILD_RECORDS,
                vec![text("GraphqlUser"), Value::from_i64(1)]
            )
            .is_err()
        );
        storage.try_close().unwrap();
    });
}
