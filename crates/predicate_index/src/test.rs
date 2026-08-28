use chrono::{TimeZone, Timelike};

use super::*;

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}

fn exact(value: &str) -> ExactValue {
    ExactValue::utf8(value).unwrap()
}

fn document(key: &str, owner: &str, updated_at: i64) -> IndexDocument {
    IndexDocument {
        record_key: RecordKey::new(key).unwrap(),
        profile: Profile::new(token("soup-flat-v1")),
        partition: token("document"),
        exact_facts: vec![ExactFact {
            attribute: token("owner"),
            value: exact(owner),
        }],
        integer_facts: vec![IntegerFact {
            attribute: token("updated-at"),
            value: updated_at,
        }],
        sort_facts: vec![IntegerFact {
            attribute: token("updated-at"),
            value: updated_at,
        }],
    }
}

#[test]
fn simplifies_without_distributing_boolean_expressions() {
    let leaf = PredicateExpr::Exact {
        attribute: token("owner"),
        value: exact("user-1"),
    };
    let expression = PredicateExpr::And(
        Box::new(PredicateExpr::All),
        Box::new(PredicateExpr::Or(
            Box::new(PredicateExpr::None),
            Box::new(PredicateExpr::Not(Box::new(PredicateExpr::Not(Box::new(
                leaf.clone(),
            ))))),
        )),
    );

    assert_eq!(expression.validate_and_simplify().unwrap(), leaf);
}

#[test]
fn validates_all_four_range_boundaries() {
    let attribute = token("updated-at");
    let document = document("Document:1", "user-1", 10);
    for (lower, upper, expected) in [
        (
            Some(RangeBound::Inclusive(10)),
            Some(RangeBound::Inclusive(10)),
            true,
        ),
        (
            Some(RangeBound::Exclusive(10)),
            Some(RangeBound::Inclusive(11)),
            false,
        ),
        (
            Some(RangeBound::Inclusive(9)),
            Some(RangeBound::Exclusive(10)),
            false,
        ),
        (
            Some(RangeBound::Exclusive(9)),
            Some(RangeBound::Exclusive(11)),
            true,
        ),
    ] {
        let expression = PredicateExpr::I64Range {
            attribute: attribute.clone(),
            lower,
            upper,
        }
        .validate_and_simplify()
        .unwrap();
        assert_eq!(document.matches(&expression), expected);
    }
}

#[test]
fn missing_fact_is_false_and_not_uses_partition_document_universe() {
    let document = document("Document:1", "user-1", 10);
    let missing = PredicateExpr::Exact {
        attribute: token("project-id"),
        value: exact("project-1"),
    };

    assert!(!document.matches(&missing));
    assert!(document.matches(&PredicateExpr::Not(Box::new(missing))));
}

#[test]
fn reference_evaluator_orders_with_stable_tie_breaker_and_limit() {
    let query = ValidatedIndexQuery::new(IndexQuery {
        profile: Profile::new(token("soup-flat-v1")),
        partitions: vec![PartitionPredicate {
            partition: token("document"),
            predicate: PredicateExpr::Exact {
                attribute: token("owner"),
                value: exact("user-1"),
            },
        }],
        sort_attribute: token("updated-at"),
        sort_direction: SortDirection::Desc,
        tie_break_direction: SortDirection::Desc,
        limit: 2,
    })
    .unwrap();
    let documents = vec![
        document("Document:1", "user-1", 10),
        document("Document:3", "user-1", 10),
        document("Document:2", "user-1", 20),
        document("Document:4", "user-2", 30),
    ];

    assert_eq!(
        evaluate_reference(&query, &documents)
            .into_iter()
            .map(|hit| hit.record_key.as_str().to_owned())
            .collect::<Vec<_>>(),
        vec!["Document:2", "Document:3"]
    );
}

#[test]
fn preserves_sub_millisecond_timestamp_precision() {
    let timestamp = Utc
        .with_ymd_and_hms(2026, 1, 1, 0, 0, 0)
        .unwrap()
        .with_nanosecond(123_456_000)
        .unwrap();

    assert_eq!(utc_timestamp_micros(timestamp) % 1_000_000, 123_456);
}

#[test]
fn deserialization_cannot_bypass_validation() {
    assert!(serde_json::from_str::<Token>(r#""not a token""#).is_err());
    assert!(
        serde_json::from_value::<ValidatedIndexQuery>(serde_json::json!({
            "profile": "soup-flat-v1",
            "partitions": [{ "partition": "document", "predicate": "All" }],
            "sort_attribute": "updated-at",
            "sort_direction": "Asc",
            "tie_break_direction": "Asc",
            "limit": 0
        }))
        .is_err()
    );

    let partition = token("document");
    let profile = Profile::new(token("soup-flat-v1"));
    let query = ValidatedIndexQuery::new(IndexQuery {
        profile: profile.clone(),
        partitions: vec![PartitionPredicate {
            partition: partition.clone(),
            predicate: PredicateExpr::Exact {
                attribute: token("owner"),
                value: exact("user-1"),
            },
        }],
        sort_attribute: token("updated-at"),
        sort_direction: SortDirection::Asc,
        tie_break_direction: SortDirection::Asc,
        limit: 20,
    })
    .unwrap();
    assert!(query.includes_scope(&profile, &partition));
    assert!(!query.includes_scope(&profile, &token("project")));

    let unknown = |affected_attributes| OptimisticProjectionMutation::Unknown {
        record_key: RecordKey::new("Document:1").unwrap(),
        profile: profile.clone(),
        partition: partition.clone(),
        affected_attributes,
    };
    assert!(unknown(Vec::new()).makes_query_uncertain(&query));
    assert!(!unknown(vec![token("file-type")]).makes_query_uncertain(&query));

    let mut too_deep = PredicateExpr::All;
    for _ in 0..MAX_EXPRESSION_DEPTH {
        too_deep = PredicateExpr::Not(Box::new(too_deep));
    }
    assert_eq!(
        too_deep.validate_and_simplify(),
        Err(ValidationError::ExpressionDepth)
    );
}

#[test]
fn rejects_empty_ranges_duplicate_partitions_and_duplicate_sort_facts() {
    assert_eq!(
        PredicateExpr::I64Range {
            attribute: token("updated-at"),
            lower: Some(RangeBound::Exclusive(10)),
            upper: Some(RangeBound::Inclusive(10)),
        }
        .validate_and_simplify(),
        Err(ValidationError::InvalidRange)
    );

    let query = IndexQuery {
        profile: Profile::new(token("soup-flat-v1")),
        partitions: vec![
            PartitionPredicate {
                partition: token("document"),
                predicate: PredicateExpr::All,
            },
            PartitionPredicate {
                partition: token("document"),
                predicate: PredicateExpr::All,
            },
        ],
        sort_attribute: token("updated-at"),
        sort_direction: SortDirection::Asc,
        tie_break_direction: SortDirection::Asc,
        limit: 20,
    };
    assert_eq!(
        ValidatedIndexQuery::new(query),
        Err(ValidationError::DuplicatePartition)
    );

    let mut document = document("Document:1", "user-1", 10);
    document.sort_facts.push(IntegerFact {
        attribute: token("updated-at"),
        value: 11,
    });
    assert_eq!(document.validate(), Err(ValidationError::DuplicateSortFact));
}

#[test]
fn uncertainty_can_clear_exact_fields_after_a_wildcard() {
    let owner = token("owner");
    let updated_at = token("updated-at");
    let mut uncertainty = OptimisticUncertainty::default();

    uncertainty.mark(&[]);
    assert!(uncertainty.affects(&owner));
    assert!(uncertainty.affects(&updated_at));

    uncertainty.clear([owner.clone()]);
    assert!(!uncertainty.affects(&owner));
    assert!(uncertainty.affects(&updated_at));

    uncertainty.mark(std::slice::from_ref(&owner));
    assert!(uncertainty.affects(&owner));
    uncertainty.clear([owner.clone(), updated_at]);
    assert!(!uncertainty.affects(&owner));
}

#[test]
fn canonical_documents_are_deterministic_and_deduplicate_membership_facts() {
    let mut document = document("Document:1", "user-1", 10);
    document.exact_facts.push(document.exact_facts[0].clone());
    document
        .integer_facts
        .push(document.integer_facts[0].clone());
    document.exact_facts.push(ExactFact {
        attribute: token("file-type"),
        value: exact("pdf"),
    });
    document.exact_facts.reverse();

    document.canonicalize();

    assert_eq!(document.exact_facts.len(), 2);
    assert_eq!(document.integer_facts.len(), 1);
    assert!(document.validate().is_ok());
    assert_eq!(document.exact_facts, {
        let mut expected = document.exact_facts.clone();
        expected.sort();
        expected
    });
}

#[test]
fn effective_projection_rejects_an_unassigned_owner() {
    let projection = EffectiveOptimisticProjection {
        owner: 0,
        state: OptimisticProjectionState::Complete(document("Document:1", "user-1", 10)),
        uncertainty: OptimisticUncertainty::default(),
    };
    assert_eq!(
        projection.validate(),
        Err(ValidationError::InvalidOptimisticOwner)
    );
}
