use super::*;

fn document(id: &str, bucket: &str, timestamp_ms: i64) -> (RecordKey, SearchDocument) {
    (
        RecordKey {
            typename: "GraphqlSoupDocument".into(),
            id: id.into(),
        },
        SearchDocument {
            profile: SearchProfile::QuickAccessV1,
            record_key: key(&format!("GraphqlSoupDocument:{id}")),
            bucket: bucket.into(),
            search_text: id.into(),
            timestamp_ms,
            source_hash: format!("{id}-{timestamp_ms}"),
        },
    )
}

fn write(storage: &TursoStorage, documents: &[(RecordKey, SearchDocument)]) {
    let pairs = documents
        .iter()
        .map(|(key, document)| (key, document))
        .collect::<Vec<_>>();
    search::upsert(&storage.connection(), &pairs).unwrap();
}

fn rows(storage: &TursoStorage) -> Vec<(i64, i64, String)> {
    driver::query(
        &storage.connection(),
        "SELECT rowid, slot, id FROM search_rows ORDER BY rowid",
        vec![],
    )
    .unwrap()
    .iter()
    .map(|row| {
        (
            required_i64(row, 0).unwrap(),
            required_i64(row, 1).unwrap(),
            required_text(row, 2).unwrap(),
        )
    })
    .collect()
}

fn slot_of(storage: &TursoStorage, bucket: &str) -> Option<i64> {
    search::find_slot(&storage.connection(), SearchProfile::QuickAccessV1, bucket).unwrap()
}

const ROW: i64 = 1 << 44;

#[test]
fn each_bucket_owns_one_rowid_range_and_a_moved_row_leaves_its_old_range() {
    let storage = TursoStorage::open_in_memory("search-slots").unwrap();
    // Another profile's slot for the same bucket name is never this profile's.
    raw_execute(
        &storage,
        "INSERT INTO search_slots (slot, profile, bucket) VALUES (1, 2, 'task')",
        vec![],
    );
    write(
        &storage,
        &[document("a", "task", 1), document("b", "document", 2)],
    );
    let task = slot_of(&storage, "task").unwrap();
    let doc = slot_of(&storage, "document").unwrap();
    assert_eq!((task, doc), (2, 3));
    assert_eq!(
        rows(&storage),
        vec![(2 * ROW, 2, "a".into()), (3 * ROW, 3, "b".into())]
    );

    // An update in the same bucket keeps its rowid.
    write(&storage, &[document("a", "task", 5)]);
    assert_eq!(rows(&storage)[0], (2 * ROW, 2, "a".into()));

    // A move takes the next rowid of the new range and drops the old row.
    write(&storage, &[document("a", "document", 6)]);
    assert_eq!(
        rows(&storage),
        vec![(3 * ROW, 3, "b".into()), (3 * ROW + 1, 3, "a".into())]
    );
    let mut loaded = Vec::new();
    block_on(async {
        for bucket in ["task", "document"] {
            loaded.push(
                storage
                    .load_search_documents(SearchProfile::QuickAccessV1, bucket)
                    .await
                    .unwrap()
                    .len(),
            );
        }
    });
    assert_eq!(loaded, vec![0, 2]);

    // An emptied range starts again at its first rowid; rows append in write order.
    write(
        &storage,
        &[document("c", "task", 7), document("a", "task", 8)],
    );
    assert_eq!(
        rows(&storage),
        vec![
            (2 * ROW, 2, "c".into()),
            (2 * ROW + 1, 2, "a".into()),
            (3 * ROW, 3, "b".into())
        ]
    );
}

#[test]
fn writes_larger_than_one_batch_take_consecutive_rowids() {
    let storage = TursoStorage::open_in_memory("search-slot-batches").unwrap();
    let documents = (0..250)
        .map(|n| document(&format!("d{n:03}"), "document", n))
        .collect::<Vec<_>>();
    write(&storage, &documents);
    let stored = rows(&storage);
    assert_eq!(stored.len(), 250);
    for (index, (rowid, slot, id)) in stored.iter().enumerate() {
        assert_eq!(*slot, 1);
        assert_eq!(*rowid, ROW + i64::try_from(index).unwrap());
        assert_eq!(id, &format!("d{index:03}"));
    }
    // Rewriting all of them, half moved, keeps one row per document.
    let documents = (0..250)
        .map(|n| {
            document(
                &format!("d{n:03}"),
                if n % 2 == 0 { "document" } else { "task" },
                n + 1,
            )
        })
        .collect::<Vec<_>>();
    write(&storage, &documents);
    assert_eq!(
        raw_scalar(&storage, "SELECT count(*) FROM search_rows WHERE slot = 1"),
        125
    );
    assert_eq!(
        raw_scalar(&storage, "SELECT count(*) FROM search_rows WHERE slot = 2"),
        125
    );
    assert_eq!(
        raw_scalar(
            &storage,
            "SELECT count(*) FROM search_rows WHERE rowid >> 44 != slot"
        ),
        0
    );
}

#[test]
fn a_duplicated_slot_is_corruption_not_a_choice() {
    let storage = TursoStorage::open_in_memory("search-slot-duplicate").unwrap();
    write(&storage, &[document("a", "task", 1)]);
    raw_execute(
        &storage,
        "INSERT INTO search_slots (slot, profile, bucket) VALUES (7, 1, 'task')",
        vec![],
    );
    assert!(
        search::find_slot(&storage.connection(), SearchProfile::QuickAccessV1, "task").is_err()
    );
}

/// A row whose slot column disagrees with its rowid range would be listed under
/// one bucket by text search, which reads the range, and another by browse,
/// which reads the slot column. Browse checks the two agree and refuses it.
#[test]
fn a_row_outside_its_slots_range_is_corruption_for_browse() {
    let tampered = |name: &str, sql: &str| {
        let storage = TursoStorage::open_in_memory(name).unwrap();
        write(
            &storage,
            &[document("a", "task", 1), document("b", "document", 2)],
        );
        raw_execute(&storage, sql, vec![]);
        storage
    };
    let moved_slot = "UPDATE search_rows SET slot = 2 WHERE id = 'a'";
    let other_profile = "UPDATE search_rows SET profile = 2 WHERE id = 'a'";
    block_on(async {
        // Browse finds the moved row through slot 2 (document), outside its range.
        let storage = tampered("search-slot-browse", moved_slot);
        expect_reset_reason(
            storage
                .browse_search_documents(SearchProfile::QuickAccessV1, "document", None, 10)
                .await,
            PhysicalResetReason::Corruption,
        );
        let storage = tampered("search-slot-browse-profile", other_profile);
        expect_reset_reason(
            storage
                .browse_search_documents(SearchProfile::QuickAccessV1, "task", None, 10)
                .await,
            PhysicalResetReason::Corruption,
        );
    });
}

#[test]
fn the_last_slot_ends_at_the_largest_row_id_without_overflow() {
    let full = |name: &str| {
        let storage = TursoStorage::open_in_memory(name).unwrap();
        raw_execute(
            &storage,
            "INSERT INTO search_slots (slot, profile, bucket) VALUES (524287, 1, 'task')",
            vec![],
        );
        raw_execute(
            &storage,
            "INSERT INTO search_rows (rowid, slot, profile, __typename, id, search_text, timestamp_ms, source_hash) VALUES (9223372036854775806, 524287, 1, 'GraphqlSoupDocument', 'old', 'old', 0, 'old')",
            vec![],
        );
        storage
    };
    let storage = full("search-slot-last");
    write(&storage, &[document("a", "task", 1)]);
    assert_eq!(rows(&storage).last().unwrap().0, i64::MAX);
    let storage = full("search-slot-past-last");
    let documents = [document("a", "task", 1), document("b", "task", 1)];
    let pairs = documents
        .iter()
        .map(|(key, document)| (key, document))
        .collect::<Vec<_>>();
    assert!(search::upsert(&storage.connection(), &pairs).is_err());
}
