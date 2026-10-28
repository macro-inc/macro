use super::*;
use predicate_index::{ExactValue, IndexQuery, PartitionPredicate};

fn query(predicate: PredicateExpr) -> ValidatedIndexQuery {
    ValidatedIndexQuery::new(IndexQuery {
        profile: Profile::new(Token::new("profile-v1").unwrap()),
        partitions: vec![PartitionPredicate {
            partition: Token::new("thing").unwrap(),
            predicate,
        }],
        sort_attribute: Token::new("updated-at").unwrap(),
        sort_direction: SortDirection::Asc,
        tie_break_direction: SortDirection::Asc,
        limit: 100,
    })
    .unwrap()
}

fn exact_owner(owner: &str) -> PredicateExpr {
    PredicateExpr::Exact {
        attribute: Token::new("owner").unwrap(),
        value: ExactValue::utf8(owner).unwrap(),
    }
}

async fn populated_storage() -> TursoStorage {
    let mut storage = TursoStorage::open_in_memory("filter-scope-cost").unwrap();
    let mut projections = Vec::new();
    for n in 0..12 {
        projections.push(ProjectionMutation::Replace(authoritative_projection(
            &format!("Thing:{n:04}"),
            if n % 2 == 0 { "selected" } else { "excluded" },
        )));
    }
    for n in 0..1_000 {
        let mut document = authoritative_projection(&format!("Other:{n:04}"), "other");
        if n % 2 == 0 {
            document.profile = Profile::new(Token::new("other-profile").unwrap());
        } else {
            document.partition = Token::new("other-partition").unwrap();
        }
        projections.push(ProjectionMutation::Replace(document));
    }
    storage
        .put_batch_with_projections(Vec::new(), projections)
        .await
        .unwrap();
    storage
}

fn assert_bounded_selection(
    storage: &TursoStorage,
    query: &ValidatedIndexQuery,
    expected: &[String],
) {
    let (sql, parameters) = compile_predicate_selection(query, &[], true);
    let mut statement = driver::prepare(&storage.connection(), &sql).unwrap();
    let rows = driver::query_prepared(&mut statement, parameters).unwrap();
    let actual = rows
        .iter()
        .map(|row| required_text(row, 0).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    let steps = statement.metrics().vm_steps;
    assert!(
        steps < 10_000,
        "selecting twelve scoped records touched unrelated cache rows: {steps} VM steps"
    );
}

#[test]
fn all_and_negated_filters_do_not_materialize_other_scopes() {
    block_on(async {
        let storage = populated_storage().await;
        let all = (0..12).map(|n| format!("Thing:{n:04}")).collect::<Vec<_>>();
        let selected = (0..12)
            .filter(|n| n % 2 == 0)
            .map(|n| format!("Thing:{n:04}"))
            .collect::<Vec<_>>();
        assert_bounded_selection(&storage, &query(PredicateExpr::All), &all);
        assert_bounded_selection(
            &storage,
            &query(PredicateExpr::Not(Box::new(exact_owner("excluded")))),
            &selected,
        );
    });
}

#[test]
fn negated_conjunctions_and_empty_partitions_stay_scoped() {
    block_on(async {
        let storage = populated_storage().await;
        let selected = (0..12)
            .filter(|n| n % 2 == 0)
            .map(|n| format!("Thing:{n:04}"))
            .collect::<Vec<_>>();
        for predicate in [
            PredicateExpr::And(
                Box::new(exact_owner("selected")),
                Box::new(PredicateExpr::Not(Box::new(exact_owner("excluded")))),
            ),
            PredicateExpr::And(
                Box::new(PredicateExpr::Not(Box::new(exact_owner("excluded")))),
                Box::new(exact_owner("selected")),
            ),
            PredicateExpr::And(
                Box::new(PredicateExpr::Not(Box::new(exact_owner("excluded")))),
                Box::new(PredicateExpr::And(
                    Box::new(PredicateExpr::Not(Box::new(exact_owner("other")))),
                    Box::new(exact_owner("selected")),
                )),
            ),
        ] {
            let mut descriptor = query(predicate).as_query().clone();
            descriptor.partitions.push(PartitionPredicate {
                partition: Token::new("other-partition").unwrap(),
                predicate: PredicateExpr::None,
            });
            assert_bounded_selection(
                &storage,
                &ValidatedIndexQuery::new(descriptor).unwrap(),
                &selected,
            );
        }
    });
}
