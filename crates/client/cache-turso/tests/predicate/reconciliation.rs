use super::*;
use cache_core::predicate::reconciliation::{PredicateBaselineEntry, PredicateReconciliation};

fn baseline(key: &str, sort_value: i64) -> PredicateBaselineEntry {
    PredicateBaselineEntry {
        record_key: RecordKey::new(key).unwrap(),
        sort_value,
    }
}

#[test]
fn hybrid_baseline_ignores_unrelated_stubs_and_preserves_rows_beyond_candidate_limit() {
    pollster::block_on(async {
        let mut storage = TursoStorage::open_in_memory("reconciliation").unwrap();
        let a = document("GraphqlSoupDocument:a", "owner-1", 10, None);
        let b = document("GraphqlSoupDocument:b", "owner-2", 15, None);
        let c = document("GraphqlSoupDocument:c", "owner-1", 25, None);
        let stub = RecordKey::new("GraphqlSoupDocument:stub").unwrap();
        let records = [&a.record_key, &b.record_key, &c.record_key, &stub]
            .into_iter()
            .map(|key| (EntityKey(key.as_str().to_owned().into()), Record::default()))
            .collect();
        storage
            .put_batch_with_projections(
                records,
                vec![
                    ProjectionMutation::Replace(a.clone()),
                    ProjectionMutation::Replace(b.clone()),
                    ProjectionMutation::Replace(c.clone()),
                    ProjectionMutation::MarkIncomplete {
                        record_key: stub.clone(),
                        profile: profile(),
                        partition: token("document"),
                        kind: ProjectionIncompleteKind::Missing,
                    },
                ],
            )
            .await
            .unwrap();
        let mut descriptor = query().as_query().clone();
        descriptor.limit = 1;
        let query = ValidatedIndexQuery::new(descriptor).unwrap();
        assert_eq!(
            storage.query_predicate_index(&query).await.unwrap(),
            PredicateQueryResult::Incomplete
        );
        let baseline = vec![
            baseline(a.record_key.as_str(), 1),
            baseline(b.record_key.as_str(), 40),
            baseline(stub.as_str(), 20),
            baseline("GraphqlSoupDocument:deleted", 100),
        ];
        let result = storage
            .reconcile_predicate_index(&query, &baseline)
            .await
            .unwrap();
        assert_eq!(
            result,
            PredicateReconciliation {
                keys: vec![c.record_key, stub.clone(), a.record_key],
                retained_keys: vec![stub],
                optimistic: false
            }
        );
    });
}

#[test]
fn unknown_shadow_does_not_block_candidates_or_reveal_stale_authority() {
    pollster::block_on(async {
        let storage = TursoStorage::open_in_memory("reconciliation-shadow").unwrap();
        let mut engine = Engine::new(storage);
        let a = document("GraphqlSoupDocument:a", "owner-1", 10, None);
        let b = document("GraphqlSoupDocument:b", "owner-1", 25, None);
        engine
            .put_records_with_projections(
                None,
                [&a, &b]
                    .into_iter()
                    .map(|doc| {
                        (
                            EntityKey(doc.record_key.as_str().to_owned().into()),
                            Record::default(),
                        )
                    })
                    .collect(),
                vec![
                    ProjectionMutation::Replace(a.clone()),
                    ProjectionMutation::Replace(b.clone()),
                ],
            )
            .await
            .unwrap();
        begin_optimistic_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Unknown {
                record_key: b.record_key.clone(),
                profile: profile(),
                partition: token("document"),
                affected_attributes: vec![token("owner")],
            }],
        )
        .await;
        assert_eq!(
            engine.query_predicate_index(&query()).await.unwrap(),
            PredicateQueryResult::Incomplete
        );
        let without_baseline = engine
            .reconcile_predicate_index(&query(), &[])
            .await
            .unwrap();
        assert_eq!(without_baseline.value.keys, vec![a.record_key.clone()]);
        let with_baseline = engine
            .reconcile_predicate_index(&query(), &[baseline(b.record_key.as_str(), 5)])
            .await
            .unwrap();
        assert_eq!(
            with_baseline.value.keys,
            vec![a.record_key.clone(), b.record_key.clone()]
        );
        assert_eq!(
            with_baseline.value.retained_keys,
            vec![b.record_key.clone()]
        );
        begin_optimistic_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Delete {
                record_key: b.record_key.clone(),
                profile: profile(),
                partition: token("document"),
            }],
        )
        .await;
        assert_eq!(
            engine
                .reconcile_predicate_index(&query(), &[baseline(b.record_key.as_str(), 5)])
                .await
                .unwrap()
                .value
                .keys,
            vec![a.record_key]
        );
    });
}

#[test]
fn all_except_uncertainty_and_irrelevant_fields_do_not_hide_known_matches() {
    pollster::block_on(async {
        let storage = TursoStorage::open_in_memory("reconciliation-certain-fields").unwrap();
        let mut engine = Engine::new(storage);
        let a = document("GraphqlSoupDocument:a", "owner-1", 10, None);
        engine
            .put_records_with_projections(
                None,
                vec![(
                    EntityKey(a.record_key.as_str().to_owned().into()),
                    Record::default(),
                )],
                vec![ProjectionMutation::Replace(a.clone())],
            )
            .await
            .unwrap();
        begin_optimistic_projection(
            &mut engine,
            vec![OptimisticProjectionMutation::Unknown {
                record_key: a.record_key.clone(),
                profile: profile(),
                partition: token("document"),
                affected_attributes: vec![token("name")],
            }],
        )
        .await;
        assert_eq!(
            engine
                .reconcile_predicate_index(&query(), &[])
                .await
                .unwrap()
                .value
                .keys,
            vec![a.record_key.clone()]
        );
        begin_optimistic_projection(
            &mut engine,
            vec![
                OptimisticProjectionMutation::Unknown {
                    record_key: a.record_key.clone(),
                    profile: profile(),
                    partition: token("document"),
                    affected_attributes: vec![],
                },
                OptimisticProjectionMutation::Patch {
                    record_key: a.record_key.clone(),
                    profile: profile(),
                    partition: token("document"),
                    exact: vec![
                        ExactAttributePatch {
                            attribute: token("owner"),
                            values: vec![ExactValue::utf8("owner-1").unwrap()],
                        },
                        ExactAttributePatch {
                            attribute: token("project-id"),
                            values: vec![],
                        },
                    ],
                    integers: vec![IntegerAttributePatch {
                        attribute: token("updated-at"),
                        values: vec![10],
                    }],
                    sorts: vec![IntegerFact {
                        attribute: token("updated-at"),
                        value: 10,
                    }],
                },
            ],
        )
        .await;
        assert_eq!(
            engine
                .reconcile_predicate_index(&query(), &[])
                .await
                .unwrap()
                .value
                .keys,
            vec![a.record_key]
        );
    });
}
