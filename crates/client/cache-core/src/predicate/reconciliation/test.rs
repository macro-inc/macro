use super::*;
use crate::predicate::ProjectionIncompleteKind;
use predicate_index::{
    ExactFact, ExactValue, IndexQuery, IntegerFact, OptimisticUncertainty, PartitionPredicate,
    PredicateExpr, Profile, Token,
};

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}
fn key(value: &str) -> RecordKey {
    RecordKey::new(format!("Thing:{value}")).unwrap()
}
fn query() -> ValidatedIndexQuery {
    ValidatedIndexQuery::new(IndexQuery {
        profile: Profile::new(token("test")),
        partitions: vec![PartitionPredicate {
            partition: token("thing"),
            predicate: PredicateExpr::Exact {
                attribute: token("owner"),
                value: ExactValue::utf8("me").unwrap(),
            },
        }],
        sort_attribute: token("updated"),
        sort_direction: SortDirection::Desc,
        tie_break_direction: SortDirection::Desc,
        limit: 1,
    })
    .unwrap()
}
fn document() -> IndexDocument {
    IndexDocument {
        record_key: key("a"),
        profile: query().as_query().profile.clone(),
        partition: token("thing"),
        exact_facts: vec![ExactFact {
            attribute: token("owner"),
            value: ExactValue::utf8("me").unwrap(),
        }],
        integer_facts: vec![],
        sort_facts: vec![IntegerFact {
            attribute: token("updated"),
            value: 10,
        }],
    }
}

#[test]
fn unknown_is_distinct_from_nonmatch_and_deletion() {
    let q = query();
    let authority = ProjectionState::Complete(document());
    assert_eq!(
        predicate_membership(&q, Some(&authority), None, true),
        PredicateMembership::Match(10)
    );
    assert_eq!(
        predicate_membership(&q, Some(&authority), None, false),
        PredicateMembership::NonMatch
    );
    assert_eq!(
        predicate_membership(&q, None, None, true),
        PredicateMembership::Unknown
    );
    let incomplete = ProjectionState::Incomplete {
        record_key: key("a"),
        profile: q.as_query().profile.clone(),
        partition: token("thing"),
        kind: ProjectionIncompleteKind::Missing,
    };
    assert_eq!(
        predicate_membership(&q, Some(&incomplete), None, true),
        PredicateMembership::Unknown
    );
    let mut changed = document();
    changed.exact_facts.clear();
    assert_eq!(
        predicate_membership(&q, Some(&ProjectionState::Complete(changed)), None, true),
        PredicateMembership::NonMatch
    );
}

#[test]
fn shadows_never_resurrect_authority_and_only_relevant_uncertainty_blocks() {
    let q = query();
    let authority = ProjectionState::Complete(document());
    let mut shadow = EffectiveOptimisticProjection {
        owner: 1,
        state: OptimisticProjectionState::Complete(document()),
        uncertainty: OptimisticUncertainty::default(),
    };
    shadow.uncertainty.mark(&[token("name")]);
    assert_eq!(
        predicate_membership(&q, Some(&authority), Some(&shadow), true),
        PredicateMembership::Match(10)
    );
    shadow.uncertainty.mark(&[token("owner")]);
    assert_eq!(
        predicate_membership(&q, Some(&authority), Some(&shadow), true),
        PredicateMembership::Unknown
    );
    shadow.state = OptimisticProjectionState::Deleted {
        record_key: key("a"),
        profile: q.as_query().profile.clone(),
        partition: token("thing"),
    };
    assert_eq!(
        predicate_membership(&q, Some(&authority), Some(&shadow), true),
        PredicateMembership::NonMatch
    );
}

#[test]
fn baseline_is_not_truncated_by_candidate_limit_and_unknowns_keep_sort_evidence() {
    let baseline = vec![
        PredicateBaselineEntry {
            record_key: key("a"),
            sort_value: 20,
        },
        PredicateBaselineEntry {
            record_key: key("b"),
            sort_value: 15,
        },
        PredicateBaselineEntry {
            record_key: key("c"),
            sort_value: 40,
        },
    ];
    let candidates = vec![ReferenceHit {
        record_key: key("d"),
        sort_value: 30,
    }];
    let result = reconcile_predicate_baseline(
        &query(),
        &baseline,
        [
            PredicateMembership::Match(10),
            PredicateMembership::Unknown,
            PredicateMembership::NonMatch,
        ],
        candidates,
        false,
    );
    assert_eq!(result.keys, vec![key("d"), key("b"), key("a")]);
    assert_eq!(result.retained_keys, vec![key("b")]);
}

#[test]
fn in_memory_reconciles_missing_stubs_without_changing_exact_api() {
    use crate::{
        predicate::{PredicateIndexStorage, PredicateQueryResult, ProjectionMutation},
        store::{InMemoryStorage, Storage},
        value::{EntityKey, Record},
    };
    // These futures are immediately ready with the in-memory adapter.
    pollster::block_on(async {
        let mut storage = InMemoryStorage::default();
        let doc = document();
        storage
            .put_batch_with_projections(
                vec![
                    (EntityKey("Thing:a".into()), Record::default()),
                    (EntityKey("Thing:stub".into()), Record::default()),
                ],
                vec![
                    ProjectionMutation::Replace(doc),
                    ProjectionMutation::MarkIncomplete {
                        record_key: key("stub"),
                        profile: query().as_query().profile.clone(),
                        partition: token("thing"),
                        kind: ProjectionIncompleteKind::Missing,
                    },
                ],
            )
            .await
            .unwrap();
        assert_eq!(
            storage.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Incomplete
        );
        let result = storage
            .reconcile_predicate_index(
                &query(),
                &[PredicateBaselineEntry {
                    record_key: key("stub"),
                    sort_value: 15,
                }],
            )
            .await
            .unwrap();
        assert_eq!(result.keys, vec![key("stub"), key("a")]);
        assert_eq!(result.retained_keys, vec![key("stub")]);
    });
}
