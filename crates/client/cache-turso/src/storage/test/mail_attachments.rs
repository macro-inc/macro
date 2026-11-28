use super::*;
use cache_core::value::CacheValue;
use item_filter_index::mail::{
    ATTACHMENT_ATTRIBUTE, AttachmentKind, DOCUMENT_PROFILES, attachment_kinds, attachment_value,
};
use proptest::prelude::*;

const THREAD: &str = "GraphqlSoupEmailThread";
const ATTACHMENT: &str = "GraphqlSoupEmailAttachment";

/// One stored attachment: `None` leaves the record out of the cache, and a
/// record of `Some(None)` holds no MIME type.
type Stored = Option<Option<&'static str>>;

/// One Mail thread document as an older build left it.
#[derive(Debug, Clone)]
struct Shape {
    profile: &'static str,
    /// Any state but complete keeps its facts out.
    complete: bool,
    /// The cache holds the thread's record.
    record: bool,
    attachments: Vec<Stored>,
}

const MIME_TYPES: [&str; 6] = [
    "application/pdf",
    "image/png",
    "image/svg+xml",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
];

fn shape() -> impl Strategy<Value = Shape> {
    let stored = prop_oneof![
        8 => prop::sample::select(MIME_TYPES.to_vec()).prop_map(|mime| Some(Some(mime))),
        1 => Just(Some(None)),
        1 => Just(None),
    ];
    (
        prop::sample::select(vec![
            DOCUMENT_PROFILES[0],
            DOCUMENT_PROFILES[1],
            "soup-mail-v4",
        ]),
        prop::bool::weighted(0.9),
        prop::bool::weighted(0.9),
        prop::collection::vec(stored, 0..4),
    )
        .prop_map(|(profile, complete, record, attachments)| Shape {
            profile,
            complete,
            record,
            attachments,
        })
}

fn attachment_key(document: usize, index: usize) -> EntityKey<'static> {
    EntityKey::entity(ATTACHMENT, &[&format!("a-{document}-{index}")])
}

fn put_record(storage: &TursoStorage, key: &EntityKey<'static>, fields: Vec<(&str, CacheValue)>) {
    let (typename, id) = key.as_ref().split_once(':').unwrap();
    let record = Record {
        fields: fields
            .into_iter()
            .map(|(field, value)| (field.to_owned(), value))
            .collect(),
    };
    raw_execute(
        storage,
        "INSERT INTO records (__typename, id, value) VALUES (?1, ?2, ?3) ON CONFLICT (__typename, id) DO UPDATE SET value = excluded.value",
        vec![
            text(typename),
            text(id),
            Value::from_blob(encode_record(&record)),
        ],
    );
}

/// Writes the shapes as a build without attachment facts left them: thread
/// and attachment records, and documents holding one other fact each.
fn store(storage: &TursoStorage, shapes: &[Shape], optimistic_owner: Option<i64>) {
    let (documents, exact) = match optimistic_owner {
        Some(_) => ("optimistic_index_documents", "optimistic_exact_facts"),
        None => ("index_documents", "exact_facts"),
    };
    for (index, shape) in shapes.iter().enumerate() {
        let id = i64::try_from(index).unwrap() + 1;
        let thread = EntityKey::entity(THREAD, &[&format!("t-{index}")]);
        let state = if shape.complete { 0 } else { 1 };
        match optimistic_owner {
            Some(owner) => raw_execute(
                storage,
                &format!(
                    "INSERT INTO {documents} (id, owner_mutation_id, record_key, profile, partition, state) VALUES (?1, ?2, ?3, ?4, 'email', ?5)"
                ),
                vec![
                    Value::from_i64(id),
                    Value::from_i64(owner),
                    text(thread.as_ref()),
                    text(shape.profile),
                    Value::from_i64(if shape.complete { 0 } else { 2 }),
                ],
            ),
            None => raw_execute(
                storage,
                &format!(
                    "INSERT INTO {documents} (id, record_key, profile, partition, state) VALUES (?1, ?2, ?3, 'email', ?4)"
                ),
                vec![
                    Value::from_i64(id),
                    text(thread.as_ref()),
                    text(shape.profile),
                    Value::from_i64(state),
                ],
            ),
        };
        raw_execute(
            storage,
            &format!(
                "INSERT INTO {exact} (document_id, attribute, value) VALUES (?1, 'mail-read', X'00')"
            ),
            vec![Value::from_i64(id)],
        );
        if optimistic_owner.is_some() {
            continue;
        }
        for (attachment, stored) in shape.attachments.iter().enumerate() {
            if let Some(mime_type) = stored {
                put_record(
                    storage,
                    &attachment_key(index, attachment),
                    vec![(
                        "mimeType",
                        mime_type.map_or(CacheValue::Null, |mime| CacheValue::String(mime.into())),
                    )],
                );
            }
        }
        if shape.record {
            let refs = (0..shape.attachments.len())
                .map(|attachment| CacheValue::Ref(attachment_key(index, attachment)))
                .collect();
            put_record(
                storage,
                &thread,
                vec![
                    ("__typename", CacheValue::String(THREAD.into())),
                    ("attachments", CacheValue::List(refs)),
                ],
            );
        }
    }
}

/// Each document's attachment facts, by document id.
fn facts(storage: &TursoStorage, exact: &str) -> Vec<(i64, Vec<u8>)> {
    driver::query(
        &storage.connection(),
        &format!(
            "SELECT document_id, value FROM {exact} WHERE attribute = ?1 ORDER BY document_id, value"
        ),
        vec![text(ATTACHMENT_ATTRIBUTE)],
    )
    .unwrap()
    .iter()
    .map(|row| (required_i64(row, 0).unwrap(), required_blob(row, 1).unwrap()))
    .collect()
}

/// What the Mail projection writes for the shapes, by the shared rule.
fn expected(shapes: &[Shape]) -> Vec<(i64, Vec<u8>)> {
    let mut expected = Vec::new();
    for (index, shape) in shapes.iter().enumerate() {
        if !shape.complete || !shape.record || !DOCUMENT_PROFILES.contains(&shape.profile) {
            continue;
        }
        let id = i64::try_from(index).unwrap() + 1;
        let kinds = attachment_kinds(shape.attachments.iter().filter_map(|stored| (*stored)?));
        let mut values = kinds
            .into_iter()
            .map(|kind| attachment_value(kind).as_bytes().to_vec())
            .collect::<Vec<_>>();
        values.sort();
        expected.extend(values.into_iter().map(|value| (id, value)));
    }
    expected
}

fn forget_version(storage: &TursoStorage) {
    raw_execute(
        storage,
        "DELETE FROM meta WHERE key = 'mail_attachment_facts'",
        vec![],
    );
}

fn ensure(storage: &TursoStorage) {
    crate::storage::mail_attachments::ensure_version(&storage.connection()).unwrap();
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Storage writes the attachment facts the projection's rule gives, to
    /// complete Mail documents only, from the records the cache holds.
    #[test]
    fn stored_threads_get_the_attachment_facts_the_projection_writes(
        shapes in prop::collection::vec(shape(), 0..24),
    ) {
        block_on(async {
            let mut storage = TursoStorage::open_in_memory("mail-attachments").unwrap();
            let owner = storage.enqueue_mutation(queued("Owner")).await.unwrap();
            store(&storage, &shapes, None);
            store(&storage, &shapes, Some(mutation_id_to_sql(owner).unwrap()));
            forget_version(&storage);
            ensure(&storage);
            assert_eq!(facts(&storage, "exact_facts"), expected(&shapes));
            assert_eq!(facts(&storage, "optimistic_exact_facts"), expected(&shapes));
            // Once recorded, a reopen changes nothing.
            raw_execute(&storage, "DELETE FROM exact_facts WHERE attribute = ?1", vec![text(ATTACHMENT_ATTRIBUTE)]);
            ensure(&storage);
            assert_eq!(facts(&storage, "exact_facts"), vec![]);
        });
    }
}

#[test]
fn every_batch_of_threads_is_read() {
    // More threads than one statement reads, so the walk crosses batches.
    let shapes = (0..600)
        .map(|index| Shape {
            profile: DOCUMENT_PROFILES[index % 2],
            complete: true,
            record: true,
            attachments: vec![Some(Some(MIME_TYPES[index % MIME_TYPES.len()]))],
        })
        .collect::<Vec<_>>();
    block_on(async {
        let storage = TursoStorage::open_in_memory("mail-attachments-batches").unwrap();
        store(&storage, &shapes, None);
        forget_version(&storage);
        ensure(&storage);
        let facts = facts(&storage, "exact_facts");
        assert_eq!(facts, expected(&shapes));
        assert_eq!(facts.len(), 500, "every thread but the zip ones");
    });
}

#[test]
fn reopening_an_older_cache_writes_the_facts_and_keeps_queued_writes() {
    let database = TursoMemoryDatabase::new("mail-attachments-reopen.db");
    let shapes = [
        Shape {
            profile: DOCUMENT_PROFILES[1],
            complete: true,
            record: true,
            attachments: vec![Some(Some("application/pdf")), Some(Some("image/png"))],
        },
        Shape {
            profile: DOCUMENT_PROFILES[1],
            complete: true,
            record: true,
            attachments: vec![],
        },
    ];
    block_on(async {
        let mut storage = database.open("mail-attachments-reopen").unwrap();
        storage.enqueue_mutation(queued("Kept")).await.unwrap();
        store(&storage, &shapes, None);
        forget_version(&storage);
        storage.try_close().unwrap();

        let storage = database.open("mail-attachments-reopen").unwrap();
        assert_eq!(
            facts(&storage, "exact_facts"),
            [AttachmentKind::Pdf, AttachmentKind::Image]
                .map(|kind| (1, attachment_value(kind).as_bytes().to_vec()))
                .to_vec()
        );
        assert_eq!(storage.queue_diagnostics().await.unwrap().depth, 1);
        storage.try_close().unwrap();
    });
}

#[test]
fn a_new_cache_records_that_it_needs_no_attachment_facts() {
    let storage = TursoStorage::open_in_memory("mail-attachments-fresh").unwrap();
    assert_eq!(
        raw_scalar(
            &storage,
            "SELECT COUNT(*) FROM meta WHERE key = 'mail_attachment_facts' AND value = '1'"
        ),
        1
    );
}

/// A document already holding the most distinct attributes a document may
/// have cannot take the fact: it becomes incomplete, as a fresh projection
/// makes it, instead of a document every later load refuses.
#[test]
fn a_document_at_the_attribute_limit_becomes_incomplete() {
    let shape = Shape {
        profile: DOCUMENT_PROFILES[1],
        complete: true,
        record: true,
        attachments: vec![Some(Some("application/pdf"))],
    };
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("mail-attachments-limit").unwrap();
        let owner = storage.enqueue_mutation(queued("Owner")).await.unwrap();
        let shapes = [shape.clone(), shape];
        store(&storage, &shapes, None);
        store(&storage, &shapes, Some(mutation_id_to_sql(owner).unwrap()));
        // One attribute of its own: document 1 reaches the limit, 2 stays one
        // below it.
        let limit = predicate_index::MAX_ATTRIBUTES_PER_DOCUMENT;
        for (document_id, extra) in [(1, limit - 1), (2, limit - 2)] {
            for index in 0..extra {
                for table in ["exact_facts", "optimistic_exact_facts"] {
                    raw_execute(
                        &storage,
                        &format!(
                            "INSERT INTO {table} (document_id, attribute, value) VALUES (?1, ?2, X'01')"
                        ),
                        vec![Value::from_i64(document_id), text(&format!("prop-{index}"))],
                    );
                }
            }
        }
        forget_version(&storage);
        ensure(&storage);

        let pdf = attachment_value(AttachmentKind::Pdf).as_bytes().to_vec();
        assert_eq!(facts(&storage, "exact_facts"), vec![(2, pdf.clone())]);
        assert_eq!(facts(&storage, "optimistic_exact_facts"), vec![(2, pdf)]);
        let keys = [0, 1]
            .map(|index| predicate_index::RecordKey::new(format!("{THREAD}:t-{index}")).unwrap());
        let states = storage.load_projection_states(&keys).await.unwrap();
        assert!(matches!(
            states[0],
            Some(ProjectionState::Incomplete {
                kind: ProjectionIncompleteKind::Missing,
                ..
            })
        ));
        assert!(matches!(states[1], Some(ProjectionState::Complete(_))));
        let shadows = storage.load_optimistic_projections(&keys).await.unwrap();
        assert!(matches!(
            shadows[0].as_ref().map(|shadow| &shadow.state),
            Some(OptimisticProjectionState::Incomplete {
                kind: ProjectionIncompleteKind::Dirty,
                ..
            })
        ));
        assert!(matches!(
            shadows[1].as_ref().map(|shadow| &shadow.state),
            Some(OptimisticProjectionState::Complete(_))
        ));
    });
}

/// The open-time cost of the step on caches of `threads` Mail threads with
/// one to three attachments each, at N and 2N. Not a regular test: run in
/// release with `--ignored --nocapture`.
#[test]
#[ignore = "a measurement: run in release with --ignored --nocapture"]
fn open_cost_at_n_and_2n() {
    // The bench generator's p90 cache holds 15,000 Mail threads and its p50
    // cache 600 (`cache-bench`'s `dataset.rs`).
    let sizes = std::env::var_os("MAIL_ATTACHMENT_THREADS").map_or_else(
        || vec![15_000, 30_000],
        |sizes| {
            sizes
                .to_str()
                .unwrap()
                .split(',')
                .map(|size| size.parse().unwrap())
                .collect()
        },
    );
    for threads in sizes {
        let shapes = (0..threads)
            .map(|index| Shape {
                profile: DOCUMENT_PROFILES[1],
                complete: true,
                record: true,
                attachments: (0..=index % 3)
                    .map(|attachment| {
                        Some(Some(MIME_TYPES[(index + attachment) % MIME_TYPES.len()]))
                    })
                    .collect(),
            })
            .collect::<Vec<_>>();
        let storage = TursoStorage::open_in_memory("mail-attachments-cost").unwrap();
        let started = std::time::Instant::now();
        store(&storage, &shapes, None);
        let stored = started.elapsed();
        forget_version(&storage);
        for row in driver::query(
            &storage.connection(),
            "EXPLAIN QUERY PLAN SELECT id, record_key FROM index_documents WHERE profile = ?1 AND partition = ?2 AND state = 0 AND id > ?3 ORDER BY id LIMIT ?4",
            vec![text(DOCUMENT_PROFILES[1]), text("email"), Value::from_i64(0), Value::from_i64(256)],
        )
        .unwrap()
        {
            println!("plan: {row:?}");
        }
        let started = std::time::Instant::now();
        ensure(&storage);
        let elapsed = started.elapsed();
        let facts = facts(&storage, "exact_facts").len();
        let started = std::time::Instant::now();
        ensure(&storage);
        let again = started.elapsed();
        println!(
            "threads={threads} facts={facts} store_ms={:.1} first_open_ms={:.1} later_open_ms={:.3}",
            stored.as_secs_f64() * 1000.0,
            elapsed.as_secs_f64() * 1000.0,
            again.as_secs_f64() * 1000.0
        );
    }
}
