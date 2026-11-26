use super::*;
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, IndexQuery, IntegerFact, PartitionPredicate,
    evaluate_reference,
};

const DOCUMENTS: i64 = 40;
const TIED: i64 = 5;
const PROFILE: &str = "profile-v1";
const SORT: &str = "created-at";
/// The most ids the channel list sends in one filter.
const BATCH: i64 = 500;

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}
fn exact(attribute: &str, value: &str) -> PredicateExpr {
    PredicateExpr::Exact {
        attribute: token(attribute),
        value: ExactValue::utf8(value).unwrap(),
    }
}
/// A balanced OR, as the app's filter compilers build one.
fn any_of(attribute: &str, values: &[String]) -> PredicateExpr {
    match values {
        [value] => exact(attribute, value),
        _ => {
            let (left, right) = values.split_at(values.len() / 2);
            PredicateExpr::Or(
                Box::new(any_of(attribute, left)),
                Box::new(any_of(attribute, right)),
            )
        }
    }
}
fn and(left: PredicateExpr, right: PredicateExpr) -> PredicateExpr {
    PredicateExpr::And(Box::new(left), Box::new(right))
}

/// Things with an `id` fact each, `TIED` to a sort value so every window
/// crosses ties, every third one without a sort fact and every even one
/// visible to `member`; a few more in a second partition.
fn documents() -> Vec<IndexDocument> {
    let thing = |n: i64, partition: &str| IndexDocument {
        record_key: PredicateRecordKey::new(format!("Thing:{partition}:{n:02}")).unwrap(),
        profile: Profile::new(token(PROFILE)),
        partition: token(partition),
        exact_facts: [("id", format!("id-{n:02}"))]
            .into_iter()
            .chain((n % 2 == 0).then(|| ("member", "me".to_owned())))
            .map(|(attribute, value)| ExactFact {
                attribute: token(attribute),
                value: ExactValue::utf8(&value).unwrap(),
            })
            .collect(),
        integer_facts: Vec::new(),
        sort_facts: if n % 3 == 2 {
            Vec::new()
        } else {
            vec![IntegerFact {
                attribute: token(SORT),
                value: n / TIED,
            }]
        },
    };
    (0..DOCUMENTS)
        .map(|n| thing(n, "thing"))
        .chain((0..8).map(|n| thing(n, "other")))
        .collect()
}

fn ids(range: impl IntoIterator<Item = i64>) -> Vec<String> {
    range.into_iter().map(|n| format!("id-{n:02}")).collect()
}

/// The lists an ID-list filter sends: a few ids, ids that are not cached,
/// one id twice, every id, and the id an optimistic layer gives a record.
fn lists() -> Vec<Vec<String>> {
    vec![
        ids([3, 11, 12, 13, 14, 26]),
        [
            ids([1, 9]),
            vec!["id-missing-1".into(), "id-missing-2".into()],
        ]
        .concat(),
        ids([10, 10, 21, 22, 23, 24, 25]),
        [ids(0..DOCUMENTS), vec!["id-missing".into()]].concat(),
        [
            ids([3, 4, 5, 6, 8]),
            vec!["id-created".into(), "id-changed".into()],
        ]
        .concat(),
        // A full batch, as the channel list sends: every cached id and the rest absent.
        [
            ids(0..DOCUMENTS),
            (DOCUMENTS..BATCH)
                .map(|n| format!("id-absent-{n}"))
                .collect(),
        ]
        .concat(),
    ]
}

fn predicates(
    list: &[String],
    direction: SortDirection,
    tie_direction: SortDirection,
) -> Vec<Vec<PartitionPredicate>> {
    // The next page's cursor: past a record inside a run of tied sort values.
    let after = PredicateExpr::After {
        attribute: token(SORT),
        value: 3,
        key: PredicateRecordKey::new("Thing:thing:17").unwrap(),
        direction,
        tie_direction,
    };
    let thing = |predicate| PartitionPredicate {
        partition: token("thing"),
        predicate,
    };
    let other = |predicate| PartitionPredicate {
        partition: token("other"),
        predicate,
    };
    vec![
        vec![thing(any_of("id", list))],
        vec![thing(and(any_of("id", list), exact("member", "me")))],
        vec![thing(and(exact("member", "me"), any_of("id", list)))],
        // The channel filter's shape: other partitions pinned to one id.
        vec![
            thing(and(any_of("id", list), exact("member", "me"))),
            other(exact("id", "id-02")),
            PartitionPredicate {
                partition: token("none"),
                predicate: PredicateExpr::None,
            },
        ],
        vec![thing(any_of("id", list)), other(any_of("id", list))],
        vec![thing(and(any_of("id", list), after.clone()))],
        vec![thing(and(
            and(any_of("id", list), exact("member", "me")),
            after,
        ))],
    ]
}

fn shadow(document: IndexDocument, uncertain: bool) -> PendingOptimisticProjection {
    PendingOptimisticProjection {
        state: OptimisticProjectionState::Complete(document),
        uncertainty: OptimisticUncertainty::Attributes(if uncertain {
            [token("id")].into()
        } else {
            BTreeSet::new()
        }),
    }
}

/// Optimistic layers over the id lists: a record whose id changes, one
/// deleted, one created, one moved to another partition, one whose sort
/// value changes into a tie, and one uncertain in its id.
fn shadows(
    docs: &[IndexDocument],
    effective: &mut Vec<IndexDocument>,
) -> Vec<PendingOptimisticProjection> {
    let at = |n: usize| docs[n].clone();
    let mut replace = |document: Option<IndexDocument>, key: &PredicateRecordKey| {
        effective.retain(|doc| &doc.record_key != key);
        effective.extend(document);
    };
    let mut changed = at(3);
    changed.exact_facts[0].value = ExactValue::utf8("id-changed").unwrap();
    replace(Some(changed.clone()), &changed.record_key);
    let deleted = at(4);
    replace(None, &deleted.record_key);
    let mut created = at(6);
    created.record_key = PredicateRecordKey::new("Thing:thing:created").unwrap();
    created.exact_facts[0].value = ExactValue::utf8("id-created").unwrap();
    replace(Some(created.clone()), &created.record_key);
    let mut moved = at(5);
    moved.partition = token("other");
    replace(Some(moved.clone()), &moved.record_key);
    let mut tied = at(13);
    tied.sort_facts = vec![IntegerFact {
        attribute: token(SORT),
        value: 0,
    }];
    replace(Some(tied.clone()), &tied.record_key);
    let uncertain = at(8);
    replace(None, &uncertain.record_key);
    vec![
        shadow(changed, false),
        PendingOptimisticProjection {
            state: OptimisticProjectionState::Deleted {
                record_key: deleted.record_key.clone(),
                profile: deleted.profile.clone(),
                partition: deleted.partition.clone(),
            },
            uncertainty: OptimisticUncertainty::Attributes(BTreeSet::new()),
        },
        shadow(created, false),
        shadow(moved, false),
        shadow(tied, false),
        shadow(uncertain, true),
    ]
}

#[test]
fn id_lists_answer_the_reference_rows_in_order_across_ties_missing_ids_shadows_and_limits() {
    block_on(async {
        for optimistic in [false, true] {
            let mut storage = TursoStorage::open_in_memory("id-list-reference").unwrap();
            let docs = documents();
            let mut effective = docs.clone();
            storage
                .put_batch_with_projections(
                    Vec::new(),
                    docs.iter()
                        .cloned()
                        .map(ProjectionMutation::Replace)
                        .collect(),
                )
                .await
                .unwrap();
            if optimistic {
                let shadows = shadows(&docs, &mut effective);
                storage
                    .enqueue_mutation_with_shadow(queued("IdListShadow"), shadows)
                    .await
                    .unwrap();
            }
            let (mut listed, mut windowed) = (0, 0);
            for list in lists() {
                for direction in [SortDirection::Asc, SortDirection::Desc] {
                    for tie_break_direction in [SortDirection::Asc, SortDirection::Desc] {
                        for partitions in predicates(&list, direction, tie_break_direction) {
                            for limit in [1, 3, 7, 100] {
                                let query = ValidatedIndexQuery::new(IndexQuery {
                                    profile: Profile::new(token(PROFILE)),
                                    partitions: partitions.clone(),
                                    sort_attribute: token(SORT),
                                    sort_direction: direction,
                                    tie_break_direction,
                                    limit,
                                })
                                .unwrap();
                                let context = format!(
                                    "{list:?}; {partitions:?}; optimistic={optimistic}, limit={limit}, order={direction:?}/{tie_break_direction:?}"
                                );
                                if bounded_selection::listed_within_window(
                                    &storage.connection(),
                                    query.as_query(),
                                )
                                .unwrap()
                                {
                                    listed += 1;
                                }
                                let reference = evaluate_reference(&query, &effective);
                                let expected = reference
                                    .iter()
                                    .map(|hit| hit.record_key.as_str().to_owned())
                                    .collect::<Vec<_>>();
                                let expected_sorts = reference
                                    .iter()
                                    .map(|hit| hit.sort_value)
                                    .collect::<Vec<_>>();
                                if both_plans(&storage, &query, &context) {
                                    windowed += 1;
                                }
                                let reconciled = storage
                                    .reconcile_predicate_index(&query, &[])
                                    .await
                                    .unwrap_or_else(|error| panic!("{error:?}; {context}"));
                                assert_eq!(
                                    reconciled.sort_values, expected_sorts,
                                    "reconcile sort values; {context}"
                                );
                                let reconciled = reconciled
                                    .keys
                                    .iter()
                                    .map(|key| key.as_str().to_owned())
                                    .collect::<Vec<_>>();
                                assert_eq!(reconciled, expected, "reconcile; {context}");
                                let queried = match storage
                                    .query_predicate_index(&query)
                                    .await
                                    .unwrap_or_else(|error| panic!("{error:?}; {context}"))
                                {
                                    PredicateQueryResult::Complete(keys)
                                    | PredicateQueryResult::Optimistic(keys) => Some(keys),
                                    PredicateQueryResult::Incomplete => None,
                                };
                                if let Some(keys) = queried {
                                    let keys = keys
                                        .iter()
                                        .map(|key| key.as_str().to_owned())
                                        .collect::<Vec<_>>();
                                    assert_eq!(keys, expected, "query; {context}");
                                } else {
                                    assert!(optimistic, "incomplete without shadows; {context}");
                                }
                            }
                        }
                    }
                }
            }
            assert!(listed > 0, "no query took the id-list plan");
            assert!(windowed > 0, "no window answered to compare with");
        }
    });
}

#[test]
fn id_lists_take_the_set_plan_only_when_their_facts_fit_the_first_window() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("id-list-routing").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                documents()
                    .into_iter()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();
        let routed = |storage: &TursoStorage, partitions: Vec<PartitionPredicate>, limit: u16| {
            let query = ValidatedIndexQuery::new(IndexQuery {
                profile: Profile::new(token(PROFILE)),
                partitions,
                sort_attribute: token(SORT),
                sort_direction: SortDirection::Desc,
                tie_break_direction: SortDirection::Desc,
                limit,
            })
            .unwrap();
            bounded_selection::listed_within_window(&storage.connection(), query.as_query())
                .unwrap()
        };
        let thing = |predicate| PartitionPredicate {
            partition: token("thing"),
            predicate,
        };
        let other = |predicate| PartitionPredicate {
            partition: token("other"),
            predicate,
        };
        // Within the minimum window of 64 candidates: 40 + 8 id facts.
        assert!(routed(
            &storage,
            vec![thing(any_of("id", &ids(0..DOCUMENTS)))],
            1
        ));
        assert!(routed(
            &storage,
            vec![
                thing(and(any_of("id", &ids(0..10)), exact("member", "me"))),
                other(exact("id", "id-02")),
            ],
            7
        ));
        // One value per partition is what the window tests cheaply.
        assert!(!routed(&storage, vec![thing(exact("id", "id-01"))], 7));
        // A list whose facts outnumber the window: the window keeps it.
        let values = (0..80).map(|n| format!("value-{n}")).collect::<Vec<_>>();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..80)
                    .map(|n| {
                        let mut doc =
                            authoritative_projection(&format!("Dense:{n:02}"), &values[n]);
                        doc.exact_facts.truncate(1);
                        ProjectionMutation::Replace(doc)
                    })
                    .collect(),
            )
            .await
            .unwrap();
        assert!(!routed(&storage, vec![thing(any_of("owner", &values))], 7));
        assert!(routed(
            &storage,
            vec![thing(any_of("owner", &values[..60]))],
            7
        ));
        // A partition whose seed is not exact keeps the window.
        assert!(!routed(
            &storage,
            vec![
                thing(any_of("id", &ids(0..3))),
                other(PredicateExpr::ExactExists {
                    attribute: token("id"),
                }),
            ],
            7
        ));
    });
}

/// Runs the query through both plans, whatever the routing would pick, and
/// checks they answer the same rows, sort values and order. Returns whether
/// the window answered (it gives up past its candidate cap).
fn both_plans(storage: &TursoStorage, query: &ValidatedIndexQuery, context: &str) -> bool {
    let connection = storage.connection();
    let excluded = optimistic_query_status(&connection, query)
        .unwrap()
        .uncertain_ids;
    let (sql, parameters) = compile_predicate_selection(query, &excluded, true);
    let set = driver::query(&connection, &sql, parameters)
        .unwrap_or_else(|error| panic!("{error:?}; set plan; {context}"))
        .iter()
        .map(|row| {
            (
                required_text(row, 0).unwrap(),
                required_i64(row, 1).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    let Some(hits) = bounded_selection::try_select(&connection, query, &excluded)
        .unwrap_or_else(|error| panic!("{error:?}; window; {context}"))
    else {
        return false;
    };
    let windows = hits
        .into_iter()
        .map(|hit| (hit.record_key.as_str().to_owned(), hit.sort_value))
        .collect::<Vec<_>>();
    assert_eq!(windows, set, "window against set plan; {context}");
    true
}

/// A list beside a residual the set-based plan flattens into one AND chain
/// too deep for Turso's parser: the window still answers it.
#[test]
fn an_id_list_the_set_plan_cannot_prepare_falls_back_to_the_window() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("id-list-deep-residual").unwrap();
        let docs = documents();
        storage
            .put_batch_with_projections(
                Vec::new(),
                docs.iter()
                    .cloned()
                    .map(ProjectionMutation::Replace)
                    .collect(),
            )
            .await
            .unwrap();
        fn none_of(values: &[String]) -> PredicateExpr {
            match values {
                [value] => PredicateExpr::Not(Box::new(exact("project", value))),
                _ => {
                    let (left, right) = values.split_at(values.len() / 2);
                    and(none_of(left), none_of(right))
                }
            }
        }
        let projects = (0..128).map(|n| format!("project-{n}")).collect::<Vec<_>>();
        let query = ValidatedIndexQuery::new(IndexQuery {
            profile: Profile::new(token(PROFILE)),
            partitions: vec![PartitionPredicate {
                partition: token("thing"),
                predicate: and(any_of("id", &ids([0, 1])), none_of(&projects)),
            }],
            sort_attribute: token(SORT),
            sort_direction: SortDirection::Desc,
            tie_break_direction: SortDirection::Desc,
            limit: 1,
        })
        .unwrap();
        assert!(
            bounded_selection::listed_within_window(&storage.connection(), query.as_query())
                .unwrap()
        );
        let expected = evaluate_reference(&query, &docs)
            .into_iter()
            .map(|hit| hit.record_key.as_str().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(expected.len(), 1);
        let actual = storage
            .reconcile_predicate_index(&query, &[])
            .await
            .unwrap()
            .keys
            .iter()
            .map(|key| key.as_str().to_owned())
            .collect::<Vec<_>>();
        assert_eq!(actual, expected);
    });
}
