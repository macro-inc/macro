use super::*;

/// A page of `count` new records, each with a projection document of a few
/// facts of every kind.
fn cold_page(
    start: usize,
    count: usize,
) -> (
    Vec<(EntityKey<'static>, Record)>,
    Vec<ProjectionMutation>,
    Vec<predicate_index::IndexDocument>,
) {
    let token = |value: &str| Token::new(value).unwrap();
    let mut records = Vec::new();
    let mut documents = Vec::new();
    for index in start..start + count {
        let id = format!("Thing:{index}");
        records.push((key(&id), record(&format!("value-{index}"))));
        let mut document = authoritative_projection(&id, &format!("owner-{}", index % 7));
        document.integer_facts.push(predicate_index::IntegerFact {
            attribute: token("size"),
            value: i64::try_from(index).unwrap(),
        });
        document.sort_facts.push(predicate_index::IntegerFact {
            attribute: token("created-at"),
            value: i64::try_from(index).unwrap() * 2,
        });
        document.canonicalize();
        documents.push(document);
    }
    let mutations = documents
        .iter()
        .cloned()
        .map(ProjectionMutation::Replace)
        .collect();
    (records, mutations, documents)
}

fn record_keys(documents: &[predicate_index::IndexDocument]) -> Vec<PredicateRecordKey> {
    documents
        .iter()
        .map(|document| document.record_key.clone())
        .collect()
}

/// Every batch size reads back whole: records in multi-row upserts and facts
/// in multi-row inserts, cut into the four batch sizes.
#[test]
fn cold_pages_of_every_size_read_back_whole() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("cold-page-sizes").unwrap();
        let mut start = 0;
        for count in [1, 3, 4, 5, 16, 63, 64, 65, 85, 150] {
            let (records, mutations, documents) = cold_page(start, count);
            storage
                .put_batch_with_projections(records.clone(), mutations)
                .await
                .unwrap();
            let keys = records
                .iter()
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            let expected = records
                .into_iter()
                .map(|(_, record)| Some(record))
                .collect::<Vec<_>>();
            assert_eq!(storage.get_batch(&keys).await.unwrap(), expected, "{count}");
            assert_eq!(
                storage
                    .load_projection_states(&record_keys(&documents))
                    .await
                    .unwrap(),
                documents
                    .into_iter()
                    .map(|document| Some(ProjectionState::Complete(document)))
                    .collect::<Vec<_>>(),
                "{count}"
            );
            start += count;
        }
        // Two exact, one integer and two sort facts per document.
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM exact_facts"),
            2 * 456
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM integer_facts"),
            456
        );
        assert_eq!(
            raw_scalar(&storage, "SELECT COUNT(*) FROM sort_facts"),
            2 * 456
        );
        let connection = storage.connection();
        for table in ["records", "exact_facts", "integer_facts", "sort_facts"] {
            assert!(
                connection.cached_texts_containing(&format!("INSERT INTO {table} ("))
                    <= INSERT_BATCH_SIZES.len() + 1,
                "{table}"
            );
        }
    });
}

/// A record written twice in one batch keeps its last value, as it did with
/// one statement per record: twice in one multi-row statement, and in two.
#[test]
fn a_record_repeated_in_one_batch_keeps_its_last_value() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("cold-page-repeat").unwrap();
        let entry = |id: &str, value: &str| (key(id), record(value));
        // Statements of 4, 4 and 1 rows.
        let entries = vec![
            entry("Thing:0", "first-0"),
            entry("Thing:1", "first-1"),
            entry("Thing:2", "first-2"),
            entry("Thing:1", "second-1"),
            entry("Thing:3", "first-3"),
            entry("Thing:3", "second-3"),
            entry("Thing:4", "first-4"),
            entry("Thing:5", "first-5"),
            entry("Thing:0", "second-0"),
        ];
        storage
            .put_batch_with_projections(entries, Vec::new())
            .await
            .unwrap();
        assert_eq!(
            storage
                .get_batch(&[key("Thing:0"), key("Thing:1"), key("Thing:3")])
                .await
                .unwrap(),
            vec![
                Some(record("second-0")),
                Some(record("second-1")),
                Some(record("second-3"))
            ]
        );
        assert_eq!(raw_scalar(&storage, "SELECT COUNT(*) FROM records"), 6);
    });
}

/// A cold write neither deletes the facts of documents that had no row nor
/// clears optimistic shadows when nothing is queued: none of those statements
/// runs, so none is kept.
#[test]
fn a_cold_write_skips_deletes_that_cannot_match() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("cold-page-deletes").unwrap();
        for page in 0..3 {
            let (records, mutations, _) = cold_page(page * 10, 10);
            storage
                .put_batch_with_projections(records, mutations)
                .await
                .unwrap();
        }
        let connection = storage.connection();
        for sql in INDEX_FACTS_DELETE {
            assert_eq!(connection.cached_copies(sql), 0, "{sql}");
        }
        assert_eq!(
            connection.cached_copies(OPTIMISTIC_INDEX_DOCUMENT_DELETE),
            0
        );
        assert_eq!(connection.cached_copies(EXACT_FACT_INSERT), 0);
    });
}

/// A document whose row id an earlier, deleted document had gets only its own
/// facts: deleting a document removes its facts, so the skipped delete has
/// nothing to remove.
#[test]
fn a_reused_document_id_starts_without_facts() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("cold-page-reused-id").unwrap();
        let (records, mutations, documents) = cold_page(0, 3);
        storage
            .put_batch_with_projections(records, mutations)
            .await
            .unwrap();
        let last = documents[2].record_key.clone();
        let reused = raw_scalar(&storage, "SELECT MAX(id) FROM index_documents");
        // In its own transaction, then deleted and replaced in one.
        storage
            .put_batch_with_projections(Vec::new(), vec![ProjectionMutation::Delete(last.clone())])
            .await
            .unwrap();
        let (_, _, fresh) = cold_page(100, 2);
        storage
            .put_batch_with_projections(
                Vec::new(),
                vec![ProjectionMutation::Replace(fresh[0].clone())],
            )
            .await
            .unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                vec![
                    ProjectionMutation::Delete(fresh[0].record_key.clone()),
                    ProjectionMutation::Replace(fresh[1].clone()),
                ],
            )
            .await
            .unwrap();
        assert_eq!(
            raw_scalar(&storage, "SELECT MAX(id) FROM index_documents"),
            reused
        );
        assert_eq!(
            storage
                .load_projection_states(&[
                    last,
                    fresh[0].record_key.clone(),
                    fresh[1].record_key.clone(),
                ])
                .await
                .unwrap(),
            vec![
                None,
                None,
                Some(ProjectionState::Complete(fresh[1].clone()))
            ]
        );
        assert_eq!(
            raw_scalar(
                &storage,
                &format!("SELECT COUNT(*) FROM exact_facts WHERE document_id = {reused}")
            ),
            2
        );
        assert_eq!(
            raw_scalar(
                &storage,
                "SELECT COUNT(*) FROM exact_facts AS f LEFT JOIN index_documents AS d ON d.id = f.document_id WHERE d.id IS NULL"
            ),
            0
        );
    });
}

/// A failure after any record of a batched page, including one inside a
/// multi-row statement, rolls back the whole page.
#[test]
fn a_failure_after_any_record_of_a_batch_rolls_back_the_page() {
    block_on(async {
        for index in 0..=70 {
            let mut storage = TursoStorage::open_in_memory("cold-page-fault").unwrap();
            storage.arm_fault(TestFault::After {
                site: TestFaultSite::Put,
                index,
            });
            let (records, mutations, _) = cold_page(0, 70);
            let result = storage.put_batch_with_projections(records, mutations).await;
            assert_eq!(result.is_err(), index < 70, "{index}");
            let expected = if index < 70 { 0 } else { 70 };
            assert_eq!(
                raw_scalar(&storage, "SELECT COUNT(*) FROM records"),
                expected,
                "{index}"
            );
            assert_eq!(
                raw_scalar(&storage, "SELECT COUNT(*) FROM index_documents"),
                expected,
                "{index}"
            );
        }
    });
}
