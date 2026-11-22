use super::*;
use item_filter_index::mail::INBOX_VIEW_DERIVATION;
use predicate_index::{ExactFact, ExactValue, IndexDocument, IntegerFact, Profile, Token};
use proptest::prelude::*;

const SOURCE: &str = "mail-inbox-ts";

/// One stored Mail-shaped document: `None` leaves a fact out.
#[derive(Debug, Clone)]
struct Shape {
    other_profile: bool,
    inbox: Option<bool>,
    has_message: Option<bool>,
    inbox_ts: Option<i64>,
    stale_target: Option<i64>,
}

fn shape() -> impl Strategy<Value = Shape> {
    (
        prop::bool::weighted(0.1),
        prop::option::of(any::<bool>()),
        prop::option::of(any::<bool>()),
        prop::option::of(-1_000i64..1_000),
        prop::option::of(-1_000i64..1_000),
    )
        .prop_map(
            |(other_profile, inbox, has_message, inbox_ts, stale_target)| Shape {
                other_profile,
                inbox,
                has_message,
                inbox_ts,
                stale_target,
            },
        )
}

fn profile_of(shape: &Shape) -> &'static str {
    if shape.other_profile {
        "soup-mail-v4"
    } else {
        INBOX_VIEW_DERIVATION.profile
    }
}

fn document(id: usize, shape: &Shape) -> IndexDocument {
    let mut exact_facts = Vec::new();
    for (attribute, value) in [
        ("mail-inbox", shape.inbox),
        ("mail-has-message", shape.has_message),
    ] {
        if let Some(value) = value {
            exact_facts.push(ExactFact {
                attribute: Token::new(attribute).unwrap(),
                value: ExactValue::new([u8::from(value)]).unwrap(),
            });
        }
    }
    let sort_facts = shape
        .inbox_ts
        .map(|value| IntegerFact {
            attribute: Token::new(SOURCE).unwrap(),
            value,
        })
        .into_iter()
        .collect();
    IndexDocument {
        record_key: predicate_index::RecordKey::new(format!("GraphqlSoupEmailThread:{id}"))
            .unwrap(),
        profile: Profile::new(Token::new(profile_of(shape)).unwrap()),
        partition: Token::new("email").unwrap(),
        exact_facts,
        integer_facts: vec![],
        sort_facts,
    }
}

/// Writes the shapes as an older build left them: no derived facts except
/// the stale ones a patch could not remove, and no derivation version.
fn store(storage: &TursoStorage, shapes: &[Shape], optimistic_owner: Option<i64>) {
    let (documents, exact, sorts) = match optimistic_owner {
        Some(_) => (
            "optimistic_index_documents",
            "optimistic_exact_facts",
            "optimistic_sort_facts",
        ),
        None => ("index_documents", "exact_facts", "sort_facts"),
    };
    for (index, shape) in shapes.iter().enumerate() {
        let id = i64::try_from(index).unwrap() + 1;
        let document = document(index, shape);
        match optimistic_owner {
            Some(owner) => raw_execute(
                storage,
                &format!(
                    "INSERT INTO {documents} (id, owner_mutation_id, record_key, profile, partition, state) VALUES (?1, ?2, ?3, ?4, 'email', 0)"
                ),
                vec![
                    Value::from_i64(id),
                    Value::from_i64(owner),
                    text(document.record_key.as_str()),
                    text(profile_of(shape)),
                ],
            ),
            None => raw_execute(
                storage,
                &format!(
                    "INSERT INTO {documents} (id, record_key, profile, partition, state) VALUES (?1, ?2, ?3, 'email', 0)"
                ),
                vec![
                    Value::from_i64(id),
                    text(document.record_key.as_str()),
                    text(profile_of(shape)),
                ],
            ),
        };
        for fact in &document.exact_facts {
            raw_execute(
                storage,
                &format!("INSERT INTO {exact} (document_id, attribute, value) VALUES (?1, ?2, ?3)"),
                vec![
                    Value::from_i64(id),
                    text(fact.attribute.as_str()),
                    Value::from_blob(fact.value.as_bytes().to_vec()),
                ],
            );
        }
        let stale = shape.stale_target.map(|value| IntegerFact {
            attribute: Token::new(INBOX_VIEW_DERIVATION.target).unwrap(),
            value,
        });
        for fact in document.sort_facts.iter().chain(stale.iter()) {
            raw_execute(
                storage,
                &format!("INSERT INTO {sorts} (document_id, attribute, value) VALUES (?1, ?2, ?3)"),
                vec![
                    Value::from_i64(id),
                    text(fact.attribute.as_str()),
                    Value::from_i64(fact.value),
                ],
            );
        }
    }
}

fn derived(storage: &TursoStorage, sorts: &str) -> Vec<(i64, i64)> {
    driver::query(
        &storage.connection(),
        &format!(
            "SELECT document_id, value FROM {sorts} WHERE attribute = ?1 ORDER BY document_id"
        ),
        vec![text(INBOX_VIEW_DERIVATION.target)],
    )
    .unwrap()
    .iter()
    .map(|row| (required_i64(row, 0).unwrap(), required_i64(row, 1).unwrap()))
    .collect()
}

fn expected(shapes: &[Shape]) -> Vec<(i64, i64)> {
    shapes
        .iter()
        .enumerate()
        .filter_map(|(index, shape)| {
            let id = i64::try_from(index).unwrap() + 1;
            // Documents of another profile keep whatever they had.
            if shape.other_profile {
                return shape.stale_target.map(|value| (id, value));
            }
            INBOX_VIEW_DERIVATION
                .derive(&document(index, shape))
                .map(|fact| (id, fact.value))
        })
        .collect()
}

fn forget_version(storage: &TursoStorage) {
    raw_execute(
        storage,
        "DELETE FROM meta WHERE key = 'sort_fact_derivations'",
        vec![],
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Storage's in-place rule writes exactly the facts the projection's rule
    /// derives, for authoritative and optimistic documents, and replaces the
    /// stale copies a patch left behind.
    #[test]
    fn stored_documents_get_the_facts_the_projection_derives(
        shapes in prop::collection::vec(shape(), 0..24),
    ) {
        block_on(async {
            let mut storage = TursoStorage::open_in_memory("derived-sorts").unwrap();
            let owner = storage.enqueue_mutation(queued("Owner")).await.unwrap();
            store(&storage, &shapes, None);
            store(&storage, &shapes, Some(mutation_id_to_sql(owner).unwrap()));
            forget_version(&storage);
            crate::storage::derived_sorts::ensure_version(&storage.connection()).unwrap();
            assert_eq!(derived(&storage, "sort_facts"), expected(&shapes));
            assert_eq!(derived(&storage, "optimistic_sort_facts"), expected(&shapes));
            // Once recorded, a reopen changes nothing.
            raw_execute(&storage, "DELETE FROM sort_facts WHERE attribute = ?1", vec![text(INBOX_VIEW_DERIVATION.target)]);
            crate::storage::derived_sorts::ensure_version(&storage.connection()).unwrap();
            assert_eq!(derived(&storage, "sort_facts"), vec![]);
        });
    }
}

#[test]
fn reopening_an_older_cache_derives_facts_and_keeps_queued_writes() {
    let database = TursoMemoryDatabase::new("derived-reopen.db");
    let shapes = [
        Shape {
            other_profile: false,
            inbox: Some(true),
            has_message: Some(true),
            inbox_ts: Some(30),
            stale_target: None,
        },
        Shape {
            other_profile: false,
            inbox: Some(false),
            has_message: Some(true),
            inbox_ts: Some(20),
            stale_target: None,
        },
    ];
    block_on(async {
        let mut storage = database.open("derived-reopen").unwrap();
        let owner = storage.enqueue_mutation(queued("Kept")).await.unwrap();
        store(&storage, &shapes, None);
        store(&storage, &shapes, Some(mutation_id_to_sql(owner).unwrap()));
        raw_execute(
            &storage,
            "INSERT INTO optimistic_uncertain_attributes (document_id, attribute) VALUES (2, ?1)",
            vec![text(SOURCE)],
        );
        forget_version(&storage);
        storage.try_close().unwrap();

        let storage = database.open("derived-reopen").unwrap();
        assert_eq!(derived(&storage, "sort_facts"), vec![(1, 30)]);
        assert_eq!(derived(&storage, "optimistic_sort_facts"), vec![(1, 30)]);
        // The copy of an uncertain source is uncertain too.
        assert_eq!(
            raw_scalar(
                &storage,
                "SELECT COUNT(*) FROM optimistic_uncertain_attributes WHERE document_id = 2 AND attribute = 'mail-inbox-view-ts'"
            ),
            1
        );
        assert_eq!(storage.queue_diagnostics().await.unwrap().depth, 1);
        storage.try_close().unwrap();
    });
}
