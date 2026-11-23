use super::*;

#[test]
fn deletion_rebases_ordered_pending_contributions_without_changing_other_keys_or_commands() {
    block_on(async {
        use predicate_index::{ExactAttributePatch, ExactValue, OptimisticProjectionMutation};
        let mut storage = TursoStorage::open_in_memory("delete-projection-rebase").unwrap();
        let a = PredicateRecordKey::new("Thing:a").unwrap();
        let b = PredicateRecordKey::new("Thing:b").unwrap();
        let original = authoritative_projection("Thing:a", "original");
        let replacement = authoritative_projection("Thing:a", "first");
        let other = authoritative_projection("Thing:b", "other");
        let layers = [
            vec![
                OptimisticProjectionMutation::Replace(replacement.clone()),
                OptimisticProjectionMutation::Replace(other.clone()),
            ],
            vec![OptimisticProjectionMutation::Patch {
                record_key: a.clone(),
                profile: replacement.profile.clone(),
                partition: replacement.partition.clone(),
                exact: vec![ExactAttributePatch {
                    attribute: Token::new("owner").unwrap(),
                    values: vec![ExactValue::utf8("last").unwrap()],
                }],
                integers: vec![],
                sorts: vec![],
            }],
        ];
        let mut last_owner = 0;
        for layer in layers {
            let mut mutation = queued("Pending");
            mutation.optimistic.optimistic_data_json =
                cache_core::queue::encode_optimistic_source(&cache_core::queue::OptimisticSource {
                    task_dependency_recipe: None,
                    client_metadata: Some(serde_json::json!({"authored":"kept"})),
                    identity_bindings: vec![],
                    mutation_data: serde_json::json!({}),
                    link_patches: vec![],
                    revalidations: vec![],
                    projection_mutations: layer,
                    uncertain_calendar_event_keys: vec![],
                });
            last_owner = storage.enqueue_mutation(mutation).await.unwrap();
        }
        storage
            .put_batch_with_projections(
                vec![],
                vec![
                    ProjectionMutation::Replace(original),
                    ProjectionMutation::Replace(other),
                ],
            )
            .await
            .unwrap();
        let commands = storage.load_mutation_queue().await.unwrap();
        let previous = storage
            .load_optimistic_projections(&[a.clone(), b.clone()])
            .await
            .unwrap();
        assert_eq!(previous[0].as_ref().unwrap().owner, last_owner);
        for _ in 0..2 {
            storage
                .put_batch_with_projections(vec![], vec![ProjectionMutation::Delete(a.clone())])
                .await
                .unwrap();
            assert_eq!(
                storage
                    .load_projection_states(std::slice::from_ref(&a))
                    .await
                    .unwrap(),
                vec![None]
            );
            assert_eq!(
                storage
                    .load_optimistic_projections(&[a.clone(), b.clone()])
                    .await
                    .unwrap(),
                previous
            );
            assert_eq!(storage.load_mutation_queue().await.unwrap(), commands);
        }
        let OptimisticProjectionState::Complete(ref final_state) =
            previous[0].as_ref().unwrap().state
        else {
            panic!("replace followed by patch remains complete")
        };
        assert!(
            final_state
                .exact_facts
                .iter()
                .any(|fact| fact.attribute == Token::new("owner").unwrap()
                    && fact.value == ExactValue::utf8("last").unwrap())
        );
    });
}

#[test]
fn normalized_updates_do_not_rewrite_unchanged_projection_facts() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("unchanged-projection-write").unwrap();
        let document = authoritative_projection("Thing:1", "owner-1");
        storage
            .put_batch_with_projections(
                vec![(key("Thing:1"), record("before"))],
                vec![ProjectionMutation::Replace(document.clone())],
            )
            .await
            .unwrap();

        let before = storage.connection().total_changes();
        storage
            .put_batch_with_projections(
                vec![(key("Thing:1"), record("after"))],
                vec![ProjectionMutation::Replace(document)],
            )
            .await
            .unwrap();

        // Only the normalized record changed. Rewriting its unchanged index
        // would delete/reinsert every fact while blocking foreground reads.
        assert_eq!(storage.connection().total_changes() - before, 1);
        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![Some(record("after"))]
        );
    });
}

#[test]
fn mixed_projection_batches_write_only_changed_authority() {
    block_on(async {
        let mut counts = Vec::new();
        for include_unchanged in [false, true] {
            let mut storage = TursoStorage::open_in_memory("mixed-projection-write").unwrap();
            let unchanged = authoritative_projection("Thing:1", "owner-1");
            let initial = authoritative_projection("Thing:2", "owner-1");
            let changed = authoritative_projection("Thing:2", "owner-2");
            storage
                .put_batch_with_projections(
                    Vec::new(),
                    vec![
                        ProjectionMutation::Replace(unchanged.clone()),
                        ProjectionMutation::Replace(initial),
                    ],
                )
                .await
                .unwrap();

            let mut mutations = vec![ProjectionMutation::Replace(changed.clone())];
            if include_unchanged {
                mutations.push(ProjectionMutation::Replace(unchanged.clone()));
            }
            let before = storage.connection().total_changes();
            storage
                .put_batch_with_projections(Vec::new(), mutations)
                .await
                .unwrap();
            counts.push(storage.connection().total_changes() - before);
            assert_eq!(
                storage
                    .load_projection_states(&[
                        PredicateRecordKey::new("Thing:1").unwrap(),
                        PredicateRecordKey::new("Thing:2").unwrap(),
                    ])
                    .await
                    .unwrap(),
                vec![
                    Some(ProjectionState::Complete(unchanged)),
                    Some(ProjectionState::Complete(changed)),
                ]
            );
        }
        assert!(counts[0] > 0);
        assert_eq!(counts[0], counts[1]);
    });
}

#[test]
fn ordered_mutations_with_unchanged_final_authority_do_not_write_facts() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("folded-projection-write").unwrap();
        let original = authoritative_projection("Thing:1", "owner-1");
        storage
            .put_batch_with_projections(
                Vec::new(),
                vec![ProjectionMutation::Replace(original.clone())],
            )
            .await
            .unwrap();
        let before = storage.connection().total_changes();
        storage
            .put_batch_with_projections(
                Vec::new(),
                vec![
                    ProjectionMutation::Replace(authoritative_projection("Thing:1", "owner-2")),
                    ProjectionMutation::Replace(original),
                ],
            )
            .await
            .unwrap();
        assert_eq!(storage.connection().total_changes(), before);
    });
}

#[test]
fn unchanged_authority_still_rebases_durable_optimistic_intent() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("unchanged-projection-rebase").unwrap();
        let original = authoritative_projection("Thing:1", "owner-1");
        let optimistic = authoritative_projection("Thing:1", "owner-2");
        let projection_key = PredicateRecordKey::new("Thing:1").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                vec![ProjectionMutation::Replace(original.clone())],
            )
            .await
            .unwrap();

        let mut mutation = queued("Pending");
        mutation.optimistic.optimistic_data_json =
            cache_core::queue::encode_optimistic_source(&cache_core::queue::OptimisticSource {
                task_dependency_recipe: None,
                client_metadata: None,
                identity_bindings: Vec::new(),
                mutation_data: serde_json::json!({}),
                link_patches: Vec::new(),
                revalidations: Vec::new(),
                projection_mutations: vec![predicate_index::OptimisticProjectionMutation::Replace(
                    optimistic.clone(),
                )],
                uncertain_calendar_event_keys: Vec::new(),
            });
        let owner = storage.enqueue_mutation(mutation).await.unwrap();
        assert_eq!(
            storage
                .load_optimistic_projections(std::slice::from_ref(&projection_key))
                .await
                .unwrap(),
            vec![None]
        );

        storage
            .put_batch_with_projections(Vec::new(), vec![ProjectionMutation::Replace(original)])
            .await
            .unwrap();
        let projections = storage
            .load_optimistic_projections(&[projection_key])
            .await
            .unwrap();
        let shadow = projections[0].as_ref().unwrap();
        assert_eq!(shadow.owner, owner);
        assert_eq!(
            shadow.state,
            OptimisticProjectionState::Complete(optimistic)
        );
    });
}

fn fact_rows(storage: &TursoStorage) -> Vec<Vec<Value>> {
    let mut rows = Vec::new();
    for table in ["exact_facts", "integer_facts", "sort_facts"] {
        rows.extend(
            driver::query(
                &storage.connection(),
                &format!(
                    "SELECT '{table}', d.record_key, f.attribute, f.value FROM {table} AS f JOIN index_documents AS d ON d.id = f.document_id ORDER BY 2, 3, 4"
                ),
                Vec::new(),
            )
            .unwrap(),
        );
    }
    rows
}

#[test]
fn a_changed_document_writes_only_its_changed_facts() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("delta-projection-write").unwrap();
        let initial = authoritative_projection("Thing:1", "owner-1");
        storage
            .put_batch_with_projections(Vec::new(), vec![ProjectionMutation::Replace(initial)])
            .await
            .unwrap();
        let mut changed = authoritative_projection("Thing:1", "owner-2");
        changed.sort_facts[0].value = 2;
        changed.integer_facts.push(predicate_index::IntegerFact {
            attribute: Token::new("size").unwrap(),
            value: 7,
        });
        let before = storage.connection().total_changes();
        storage
            .put_batch_with_projections(
                Vec::new(),
                vec![ProjectionMutation::Replace(changed.clone())],
            )
            .await
            .unwrap();
        // One exact fact and one sort value replaced, one integer fact added;
        // the document row and the unchanged relation fact are left alone.
        assert_eq!(storage.connection().total_changes() - before, 5);
        assert_eq!(
            storage
                .load_projection_states(&[PredicateRecordKey::new("Thing:1").unwrap()])
                .await
                .unwrap(),
            vec![Some(ProjectionState::Complete(changed))]
        );
    });
}

#[test]
fn a_repeated_fact_is_stored_once() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("delta-projection-repeated").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                vec![ProjectionMutation::Replace(authoritative_projection(
                    "Thing:1", "owner-1",
                ))],
            )
            .await
            .unwrap();
        let mut repeated = authoritative_projection("Thing:1", "owner-2");
        repeated.exact_facts.push(repeated.exact_facts[0].clone());
        storage
            .put_batch_with_projections(Vec::new(), vec![ProjectionMutation::Replace(repeated)])
            .await
            .unwrap();
        assert_eq!(
            storage
                .load_projection_states(&[PredicateRecordKey::new("Thing:1").unwrap()])
                .await
                .unwrap(),
            vec![Some(ProjectionState::Complete(authoritative_projection(
                "Thing:1", "owner-2"
            )))]
        );
    });
}

/// Differential check against the full rewrite: each step is written as a
/// delta over the previous state in one storage, and from nothing in another.
#[test]
fn delta_writes_leave_the_same_facts_as_full_rewrites() {
    block_on(async {
        let mut seed = 0x9e37_79b9_7f4a_7c15_u64;
        let mut next = |bound: u64| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed % bound
        };
        let token = |value: &str| Token::new(value).unwrap();
        let mut delta = TursoStorage::open_in_memory("delta-differential-a").unwrap();
        let mut full = TursoStorage::open_in_memory("delta-differential-b").unwrap();
        let keys = ["Thing:1", "Thing:2", "Thing:3"];
        for step in 0..400 {
            let key = keys[next(3) as usize];
            let mut document = authoritative_projection(key, "owner");
            document.exact_facts.clear();
            document.sort_facts.clear();
            if next(4) == 0 {
                document.partition = token("other");
            }
            let mut exact = BTreeSet::new();
            for _ in 0..next(5) {
                exact.insert((next(3), next(3)));
            }
            document.exact_facts = exact
                .into_iter()
                .map(|(attribute, value)| predicate_index::ExactFact {
                    attribute: token(&format!("e{attribute}")),
                    value: predicate_index::ExactValue::utf8(format!("v{value}")).unwrap(),
                })
                .collect();
            let mut integer = BTreeSet::new();
            for _ in 0..next(4) {
                integer.insert((next(2), next(3) as i64 - 1));
            }
            document.integer_facts = integer
                .into_iter()
                .map(|(attribute, value)| predicate_index::IntegerFact {
                    attribute: token(&format!("i{attribute}")),
                    value,
                })
                .collect();
            for attribute in 0..next(3) {
                document.sort_facts.push(predicate_index::IntegerFact {
                    attribute: token(&format!("s{attribute}")),
                    value: next(3) as i64,
                });
            }
            let record_key = document.record_key.clone();
            delta
                .put_batch_with_projections(
                    Vec::new(),
                    vec![ProjectionMutation::Replace(document.clone())],
                )
                .await
                .unwrap();
            full.put_batch_with_projections(
                Vec::new(),
                vec![ProjectionMutation::Delete(record_key)],
            )
            .await
            .unwrap();
            full.put_batch_with_projections(
                Vec::new(),
                vec![ProjectionMutation::Replace(document)],
            )
            .await
            .unwrap();
            assert_eq!(fact_rows(&delta), fact_rows(&full), "step {step}");
        }
        let keys = keys.map(|key| PredicateRecordKey::new(key).unwrap());
        assert_eq!(
            delta.load_projection_states(&keys).await.unwrap(),
            full.load_projection_states(&keys).await.unwrap()
        );
    });
}
