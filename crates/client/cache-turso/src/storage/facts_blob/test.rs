use super::*;
use predicate_index::{
    PredicateExpr, Profile, RangeBound, RecordKey, SortDirection, matches_facts,
};
use proptest::prelude::*;

fn token(name: &str) -> Token {
    Token::new(name).unwrap()
}

const ATTRIBUTES: [&str; 4] = ["a", "label", "mail-inbox-ts", "z.z"];

fn document() -> impl Strategy<Value = IndexDocument> {
    let exact = prop::collection::vec(
        (
            0..ATTRIBUTES.len(),
            prop::collection::vec(any::<u8>(), 0..40),
        ),
        0..24,
    );
    let integer = prop::collection::vec((0..ATTRIBUTES.len(), any::<i64>()), 0..12);
    let sort = prop::collection::btree_map(0..ATTRIBUTES.len(), any::<i64>(), 0..4);
    (exact, integer, sort, "[a-z:]{1,12}").prop_map(|(exact, integer, sort, key)| IndexDocument {
        record_key: RecordKey::new(key).unwrap(),
        profile: Profile::new(token("p")),
        partition: token("part"),
        exact_facts: exact
            .into_iter()
            .map(|(attribute, value)| ExactFact {
                attribute: token(ATTRIBUTES[attribute]),
                value: ExactValue::new(value).unwrap(),
            })
            .collect(),
        integer_facts: integer
            .into_iter()
            .map(|(attribute, value)| IntegerFact {
                attribute: token(ATTRIBUTES[attribute]),
                value,
            })
            .collect(),
        sort_facts: sort
            .into_iter()
            .map(|(attribute, value)| IntegerFact {
                attribute: token(ATTRIBUTES[attribute]),
                value,
            })
            .collect(),
    })
}

fn bound() -> impl Strategy<Value = Option<RangeBound>> {
    prop_oneof![
        Just(None),
        (-3i64..3).prop_map(|value| Some(RangeBound::Inclusive(value))),
        (-3i64..3).prop_map(|value| Some(RangeBound::Exclusive(value))),
        any::<i64>().prop_map(|value| Some(RangeBound::Inclusive(value))),
    ]
}

fn direction() -> impl Strategy<Value = SortDirection> {
    prop_oneof![Just(SortDirection::Asc), Just(SortDirection::Desc)]
}

fn expression() -> impl Strategy<Value = PredicateExpr> {
    let attribute = (0..ATTRIBUTES.len()).prop_map(|index| token(ATTRIBUTES[index]));
    let leaf = prop_oneof![
        Just(PredicateExpr::All),
        Just(PredicateExpr::None),
        (attribute.clone(), prop::collection::vec(any::<u8>(), 0..3)).prop_map(
            |(attribute, value)| PredicateExpr::Exact {
                attribute,
                value: ExactValue::new(value).unwrap(),
            }
        ),
        attribute
            .clone()
            .prop_map(|attribute| PredicateExpr::ExactExists { attribute }),
        (attribute.clone(), bound(), bound()).prop_map(|(attribute, lower, upper)| {
            PredicateExpr::I64Range {
                attribute,
                lower,
                upper,
            }
        }),
        (
            attribute,
            -3i64..3,
            "[a-z:]{1,12}",
            direction(),
            direction()
        )
            .prop_map(|(attribute, value, key, direction, tie_direction)| {
                PredicateExpr::After {
                    attribute,
                    value,
                    key: RecordKey::new(key).unwrap(),
                    direction,
                    tie_direction,
                }
            }),
    ];
    leaf.prop_recursive(4, 24, 2, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone())
                .prop_map(|(left, right)| PredicateExpr::And(Box::new(left), Box::new(right))),
            (inner.clone(), inner.clone())
                .prop_map(|(left, right)| PredicateExpr::Or(Box::new(left), Box::new(right))),
            inner.prop_map(|expr| PredicateExpr::Not(Box::new(expr))),
        ]
    })
}

/// Small values make exact and range hits likely.
fn small_values(mut document: IndexDocument) -> IndexDocument {
    for fact in &mut document.exact_facts {
        let bytes = fact.value.as_bytes();
        fact.value = ExactValue::new(bytes[..bytes.len().min(2)].to_vec()).unwrap();
    }
    for fact in document
        .integer_facts
        .iter_mut()
        .chain(document.sort_facts.iter_mut())
    {
        fact.value %= 4;
    }
    document
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(4_000))]

    #[test]
    fn a_blob_holds_the_canonical_document(document in document()) {
        let blob = encode(&document);
        let facts = decode(&blob).unwrap();
        let mut expected = document.clone();
        expected.canonicalize();
        let decoded = facts
            .into_document(document.record_key.clone(), document.profile.clone(), document.partition.clone())
            .unwrap();
        prop_assert_eq!(decoded, expected);
    }

    #[test]
    fn a_blob_matches_what_its_document_matches(
        document in document().prop_map(small_values),
        expr in expression(),
    ) {
        let blob = encode(&document);
        let facts = decode(&blob).unwrap();
        prop_assert_eq!(
            matches_facts(&facts, document.record_key.as_str(), &expr),
            document.matches(&expr)
        );
    }

    #[test]
    fn a_damaged_blob_is_refused_or_read_within_bounds(
        document in document(),
        cut in any::<prop::sample::Index>(),
        flip in any::<(prop::sample::Index, u8)>(),
    ) {
        let blob = encode(&document);
        // Truncation never decodes: every section is counted.
        prop_assert!(decode(&blob[..cut.index(blob.len())]).is_none());
        let mut damaged = blob.clone();
        let at = flip.0.index(damaged.len());
        damaged[at] ^= flip.1 | 1;
        // A flipped byte may still decode into other facts; it must not panic.
        let _ = decode(&damaged);
    }
}

#[test]
fn repeated_attributes_are_written_once() {
    let mut document = IndexDocument {
        record_key: RecordKey::new("GraphqlEmailThread:t").unwrap(),
        profile: Profile::new(token("p")),
        partition: token("part"),
        exact_facts: Vec::new(),
        integer_facts: Vec::new(),
        sort_facts: Vec::new(),
    };
    for value in ["a", "b", "c"] {
        document.exact_facts.push(ExactFact {
            attribute: token("label"),
            value: ExactValue::utf8(value).unwrap(),
        });
    }
    // version, count, "label" once (1 + 5), then 0 for each repeat, and three
    // one-byte values (2 each), then two empty sections.
    assert_eq!(encode(&document).len(), 1 + 1 + 6 + 2 + 1 + 2 + 1 + 2 + 2);
}
