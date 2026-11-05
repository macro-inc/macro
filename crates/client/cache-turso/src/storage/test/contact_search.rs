use super::*;
use crate::storage::contact_search as contact_index;
use cache_core::value::CacheValue;

#[test]
fn contact_reads_use_both_covering_indexes_without_a_sort_or_limit() {
    let storage = TursoStorage::open_in_memory("contact-plan").unwrap();
    for query in ["", "Directory", "é%_", "nul\0term"] {
        let (sql, values) = search::statement_with_base(
            contact_index::LOAD,
            SearchProfile::QuickAccessV1,
            "person",
            &SearchQuery::new(query),
        );
        let rows = driver::query(
            &storage.connection(),
            &format!("EXPLAIN QUERY PLAN {sql}"),
            values,
        )
        .unwrap();
        let plan = rows
            .iter()
            .map(|row| required_text(row, 3).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            plan.contains("COVERING INDEX search_documents_browse_idx"),
            "{plan}"
        );
        assert!(
            plan.contains("COVERING INDEX records_contacts_cover_idx"),
            "{plan}"
        );
        assert!(!plan.contains("TEMP B-TREE"), "{plan}");
        assert!(!sql.contains("LIMIT"));
    }
}

#[test]
fn missing_or_altered_contact_index_is_incompatible_not_a_partial_read() {
    for sql in [
        None,
        Some("CREATE INDEX records_contacts_cover_idx ON records (__typename, id, value)"),
        Some(
            "CREATE INDEX records_contacts_cover_idx ON records (__typename, id) WHERE __typename = 'GraphqlContact'",
        ),
        Some(
            "CREATE INDEX records_contacts_cover_idx ON records (__typename, value, id) WHERE __typename = 'GraphqlContact'",
        ),
        Some(
            "CREATE INDEX records_contacts_cover_idx ON records (__typename, id COLLATE NOCASE, value) WHERE __typename = 'GraphqlContact'",
        ),
        Some(
            "CREATE INDEX records_contacts_cover_idx ON records (__typename, id, value) WHERE __typename = 'graphqlcontact'",
        ),
        Some(
            "CREATE INDEX records_contacts_cover_idx ON records (__typename, id, value) WHERE __typename = 'Graphql Contact'",
        ),
    ] {
        let database = TursoMemoryDatabase::new("invalid-contact-index.db");
        let storage = database.open("scope").unwrap();
        raw_execute(&storage, "DROP INDEX records_contacts_cover_idx", vec![]);
        if let Some(sql) = sql {
            raw_execute(&storage, sql, vec![]);
        }
        storage.try_close().unwrap();
        expect_reset_reason(database.open("scope"), PhysicalResetReason::Compatibility);
    }
}

#[test]
fn covering_contact_payloads_follow_updates_deletes_and_reopen() {
    block_on(async {
        let database = TursoMemoryDatabase::new("contact-covering.db");
        let mut engine = cache_core::engine::Engine::new(database.open("scope").unwrap());
        let generation = engine.current_storage_generation().await.unwrap();
        let mut storage = engine.into_storage();
        let key = key("GraphqlContact:8b6318fd-4063-5ddb-90c2-83a401b63538");
        let mut person = Record {
            fields: [
                ("id".into(), CacheValue::String(key.id().unwrap().into())),
                (
                    "userId".into(),
                    CacheValue::String("macro|person@example.com".into()),
                ),
                (
                    "email".into(),
                    CacheValue::String("person@example.com".into()),
                ),
                ("name".into(), CacheValue::String("Before".into())),
            ]
            .into(),
        };
        storage
            .put_batch(vec![(key.clone(), person.clone())])
            .await
            .unwrap();
        let mut read = None;
        storage
            .visit_contact_records(&SearchQuery::new("Before"), |_, row| {
                read = Some(row.clone())
            })
            .await
            .unwrap();
        assert_eq!(read, Some(person.clone()));
        person
            .fields
            .insert("name".into(), CacheValue::String("After".repeat(1024)));
        assert_eq!(
            cache_core::codec::encode_record(&person)[0],
            1,
            "exercise a compressed payload"
        );
        storage
            .put_batch(vec![(key.clone(), person.clone())])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Retained")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        storage.try_close().unwrap();
        let mut engine = cache_core::engine::Engine::new(database.open("scope").unwrap());
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            generation
        );
        let mut storage = engine.into_storage();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        let mut visits = 0;
        storage
            .visit_contact_records(&SearchQuery::new("Before"), |_, _| visits += 1)
            .await
            .unwrap();
        assert_eq!(visits, 0);
        storage
            .visit_contact_records(&SearchQuery::new("After"), |_, row| {
                visits += 1;
                assert_eq!(row, &person);
            })
            .await
            .unwrap();
        assert_eq!(visits, 1);
        storage.delete_batch(&[key]).await.unwrap();
        storage
            .visit_contact_records(&SearchQuery::new("After"), |_, _| visits += 1)
            .await
            .unwrap();
        assert_eq!(visits, 1);
    });
}
