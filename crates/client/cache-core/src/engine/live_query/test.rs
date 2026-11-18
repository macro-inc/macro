use super::*;
use crate::{store::InMemoryStorage, value::CacheValue};
use pollster::block_on;
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, IndexQuery, IntegerFact, PartitionPredicate,
    PredicateExpr, Profile, SortDirection, Token,
};
use serde_json::json;

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}
fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity("GraphqlSoupEmailThread", &[id])
}
fn projection(id: &str, read: bool, sort: i64) -> IndexDocument {
    IndexDocument {
        record_key: PredicateRecordKey::new(key(id).to_string()).unwrap(),
        profile: Profile::new(token("test-live")),
        partition: token("email"),
        exact_facts: vec![ExactFact {
            attribute: token("read"),
            value: ExactValue::utf8(if read { "true" } else { "false" }).unwrap(),
        }],
        integer_facts: vec![],
        sort_facts: vec![IntegerFact {
            attribute: token("sort"),
            value: sort,
        }],
    }
}
fn spec() -> LiveQuerySpec {
    LiveQuerySpec {
        query: ValidatedIndexQuery::new(IndexQuery {
            profile: Profile::new(token("test-live")),
            partitions: vec![PartitionPredicate {
                partition: token("email"),
                predicate: PredicateExpr::Exact {
                    attribute: token("read"),
                    value: ExactValue::utf8("false").unwrap(),
                },
            }],
            sort_attribute: token("sort"),
            sort_direction: SortDirection::Desc,
            tie_break_direction: SortDirection::Desc,
            limit: 20,
        })
        .unwrap(),
        baseline: vec![],
        selection: Arc::new(
            RecordSelection::parse(
                crate::meta::bundled_schema_ref(),
                "fragment Item on GraphqlSoupEmailThread { id read: isRead }",
                "Item",
            )
            .unwrap(),
        ),
    }
}
async fn seed(engine: &mut Engine<InMemoryStorage>, id: &str, sort: i64) {
    engine
        .put_records_with_projections(
            None,
            vec![(
                key(id),
                Record {
                    fields: BTreeMap::from([
                        (
                            "__typename".into(),
                            CacheValue::String("GraphqlSoupEmailThread".into()),
                        ),
                        ("id".into(), CacheValue::String(id.into())),
                        ("isRead".into(), CacheValue::Bool(false)),
                    ]),
                },
            )],
            vec![ProjectionMutation::Replace(projection(id, false, sort))],
        )
        .await
        .unwrap();
}

#[test]
fn only_changed_rows_are_projected_and_each_subscriber_gets_a_coherent_delta() {
    block_on(async {
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        for id in 0..100 {
            seed(&mut engine, &id.to_string(), id).await;
        }
        let first = engine.read_live_query("a", spec(), None).await.unwrap();
        let second = engine.read_live_query("b", spec(), None).await.unwrap();
        assert_eq!(first.upserts.len(), 20);
        let read_count = engine.storage().record_get_count();
        let unchanged = engine
            .read_live_query("a", spec(), Some(first.revision.parse().unwrap()))
            .await
            .unwrap();
        assert!(unchanged.upserts.is_empty());
        assert!(unchanged.keys.is_none());
        assert_eq!(engine.storage().record_get_count(), read_count);
        engine
            .put_records_with_projections(
                None,
                vec![(
                    key("99"),
                    Record {
                        fields: BTreeMap::from([("isRead".into(), CacheValue::Bool(true))]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        let read_count = engine.storage().record_get_count();
        for (id, revision) in [("a", first.revision), ("b", second.revision)] {
            let update = engine
                .read_live_query(id, spec(), Some(revision.parse().unwrap()))
                .await
                .unwrap();
            assert!(!update.reset);
            assert!(update.keys.is_none());
            assert!(update.upserts.is_empty());
            assert_eq!(update.patches.len(), 1);
            assert_eq!(
                serde_json::to_value(&update.patches[0].fields).unwrap(),
                json!([{"path":["read"], "value":true}])
            );
        }
        assert_eq!(
            engine.storage().record_get_count(),
            read_count,
            "unaffected cold rows must not be read again"
        );
    });
}

#[test]
fn projection_changes_move_members_and_failed_optimism_restores_them() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, "a", 1).await;
        seed(&mut engine, "b", 2).await;
        let first = engine.read_live_query("view", spec(), None).await.unwrap();
        let variables = json!({"input":{"threadId":"b"}})
            .as_object()
            .unwrap()
            .clone();
        let (id, _) = engine.begin_optimistic_write_with_projections(None, BeginOptimisticWrite {
            client_metadata: None,
            uuid: "00000000-0000-4000-8000-000000000001",
            query: "mutation Read($input: MarkEmailThreadSeenInput!) { markEmailThreadSeen(input: $input) { id isRead } }",
            operation_name: None, variables: &variables, data: &json!({"markEmailThreadSeen":{"id":"b","isRead":true}}),
            link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 0,
        }, vec![OptimisticProjectionMutation::Replace(projection("b", true, 2))]).await.unwrap();
        let optimistic = engine
            .read_live_query("view", spec(), Some(first.revision.parse().unwrap()))
            .await
            .unwrap();
        assert_eq!(
            optimistic
                .keys
                .unwrap()
                .iter()
                .map(|key| key.as_str())
                .collect::<Vec<_>>(),
            ["GraphqlSoupEmailThread:a"]
        );
        assert_eq!(optimistic.removed, [key("b")]);
        let claim = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "test".into(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .rollback_optimistic_write(
                id,
                MutationClaimToken {
                    owner: "test".into(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
        let rollback = engine
            .read_live_query("view", spec(), Some(optimistic.revision.parse().unwrap()))
            .await
            .unwrap();
        assert_eq!(
            rollback
                .keys
                .unwrap()
                .iter()
                .map(|key| key.as_str())
                .collect::<Vec<_>>(),
            ["GraphqlSoupEmailThread:b", "GraphqlSoupEmailThread:a"]
        );
        assert_eq!(rollback.upserts.len(), 1);
        assert_eq!(rollback.upserts[0].record, json!({"id":"b","read":false}));
    });
}

#[test]
fn stale_cursors_and_released_views_receive_full_replacements() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, "a", 1).await;
        let first = engine.read_live_query("view", spec(), None).await.unwrap();
        let stale = engine
            .read_live_query("view", spec(), Some(CacheRevision::ZERO))
            .await
            .unwrap();
        assert!(stale.reset);
        assert_eq!(stale.upserts.len(), 1);
        engine.release_live_query("view");
        let renewed = engine
            .read_live_query("view", spec(), Some(first.revision.parse().unwrap()))
            .await
            .unwrap();
        assert!(renewed.reset);
        assert_eq!(renewed.upserts.len(), 1);
        engine.clear().await.unwrap();
        let cleared = engine
            .read_live_query("view", spec(), Some(renewed.revision.parse().unwrap()))
            .await
            .unwrap();
        assert!(cleared.reset);
        assert!(cleared.upserts.is_empty());
    });
}

#[test]
fn nested_entity_changes_patch_only_the_selected_alias() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, "a", 1).await;
        let notification = EntityKey::entity("GraphqlNotification", &["n"]);
        engine
            .put_records_with_projections(
                None,
                vec![
                    (
                        key("a"),
                        Record {
                            fields: BTreeMap::from([(
                                "notifications".into(),
                                CacheValue::List(vec![CacheValue::Ref(notification.clone())]),
                            )]),
                        },
                    ),
                    (
                        notification.clone(),
                        Record {
                            fields: BTreeMap::from([
                                (
                                    "__typename".into(),
                                    CacheValue::String("GraphqlNotification".into()),
                                ),
                                ("id".into(), CacheValue::String("n".into())),
                                ("state".into(), CacheValue::String("UNSEEN".into())),
                            ]),
                        },
                    ),
                ],
                vec![],
            )
            .await
            .unwrap();
        let mut query = spec();
        query.selection = Arc::new(RecordSelection::parse(crate::meta::bundled_schema_ref(), "fragment Item on GraphqlSoupEmailThread { id pending: notifications { id status: state } }", "Item").unwrap());
        let initial = engine
            .read_live_query("nested", query.clone(), None)
            .await
            .unwrap();
        engine
            .put_records_with_projections(
                None,
                vec![(
                    notification,
                    Record {
                        fields: BTreeMap::from([(
                            "state".into(),
                            CacheValue::String("DONE".into()),
                        )]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        assert!(
            !engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .contains(&initial.observation_id)
        );
        let change = engine
            .read_live_query("nested", query, Some(initial.revision.parse().unwrap()))
            .await
            .unwrap();
        assert!(change.upserts.is_empty());
        assert!(change.keys.is_none());
        assert_eq!(change.patches.len(), 1);
        assert_eq!(
            serde_json::to_value(&change.patches[0].fields).unwrap(),
            json!([{"path":["pending",0,"status"],"value":"DONE"}])
        );
    });
}

#[test]
fn window_proofs_exclude_offscreen_changes_but_keep_entrants_and_selected_writes() {
    block_on(async {
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        for id in 0..40 {
            seed(&mut engine, &id.to_string(), id).await;
        }
        let first = engine
            .read_live_query("visible", spec(), None)
            .await
            .unwrap();
        seed(&mut engine, "offscreen", -1).await;
        assert_eq!(
            engine.unchanged_observed_windows().await.unwrap(),
            vec![first.observation_id]
        );
        // A matching newcomer inside the sort boundary must wake the window.
        seed(&mut engine, "entrant", 100).await;
        assert!(
            engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .is_empty()
        );
        engine
            .read_live_query("visible", spec(), None)
            .await
            .unwrap();
        engine
            .put_records_with_projections(
                None,
                vec![(
                    key("39"),
                    Record {
                        fields: BTreeMap::from([("isRead".into(), CacheValue::Bool(true))]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        assert!(
            engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn window_proofs_require_fragment_dependencies_and_fail_closed_on_journal_barriers() {
    block_on(async {
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        seed(&mut engine, "visible", 100).await;
        let selected = spec();
        let keys = vec![PredicateRecordKey::new(key("visible").to_string()).unwrap()];
        let id = engine.observe_predicate_window(selected.query, &keys, None, BTreeSet::new());
        assert!(
            engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .is_empty()
        );
        engine
            .read_records_by_keys(&selected.selection, &[key("visible")])
            .await
            .unwrap();
        assert_eq!(engine.unchanged_observed_windows().await.unwrap(), vec![id]);
        // Even an apparently empty change cannot cross an unknown journal entry.
        engine.advance_revision().unwrap();
        assert!(
            engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn discarded_reads_cannot_relabel_an_old_displayed_window_as_unchanged() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, "visible", 100).await;
        let accepted = engine
            .read_live_query("same-subscription", spec(), None)
            .await
            .unwrap();
        seed(&mut engine, "entrant", 101).await;
        // The engine advances its view, but the caller never accepts this reply.
        let discarded = engine
            .read_live_query("same-subscription", spec(), None)
            .await
            .unwrap();
        assert_ne!(accepted.observation_id, discarded.observation_id);
        seed(&mut engine, "unrelated", -1).await;
        engine
            .put_records_with_projections(
                None,
                vec![],
                vec![ProjectionMutation::Replace(projection(
                    "unrelated",
                    true,
                    -1,
                ))],
            )
            .await
            .unwrap();
        let unchanged = engine.unchanged_observed_windows().await.unwrap();
        assert!(!unchanged.contains(&accepted.observation_id));
        assert!(unchanged.contains(&discarded.observation_id));
    });
}

#[test]
fn evicted_observations_never_suppress_a_refresh() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, "visible", 100).await;
        let accepted = engine
            .read_live_query("subscription", spec(), None)
            .await
            .unwrap();
        for _ in 0..64 {
            engine
                .read_live_query("subscription", spec(), None)
                .await
                .unwrap();
        }
        assert!(
            !engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .contains(&accepted.observation_id)
        );
    });
}

#[test]
fn predicate_catalog_inputs_track_fields_without_waking_for_unrelated_parent_fields() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let user = EntityKey::entity("GraphqlUser", &["viewer"]);
        engine
            .put_records_with_projections(
                None,
                vec![(
                    user.clone(),
                    Record {
                        fields: BTreeMap::from([("emailLinks".into(), CacheValue::List(vec![]))]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        let id = engine.observe_predicate_window(spec().query, &[], None, BTreeSet::new());
        engine.observe_window_field(
            &id,
            user.clone(),
            "emailLinks".into(),
            Some(CacheValue::List(vec![])),
        );
        engine
            .put_records_with_projections(
                None,
                vec![(
                    user.clone(),
                    Record {
                        fields: BTreeMap::from([(
                            "soup".into(),
                            CacheValue::String("new-page".into()),
                        )]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        assert!(
            engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .contains(&id)
        );
        engine
            .put_records_with_projections(
                None,
                vec![(
                    user,
                    Record {
                        fields: BTreeMap::from([(
                            "emailLinks".into(),
                            CacheValue::List(vec![CacheValue::Ref(EntityKey::entity(
                                "GraphqlEmailLink",
                                &["account"],
                            ))]),
                        )]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        assert!(
            !engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .contains(&id)
        );
    });
}

#[test]
fn calendar_coverage_commits_preserve_unaffected_predicate_windows() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, "visible", 100).await;
        let accepted = engine
            .read_live_query("subscription", spec(), None)
            .await
            .unwrap();
        engine
            .calendar_commit(&crate::calendar::CalendarCommit::default())
            .await
            .unwrap();
        assert!(
            engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .contains(&accepted.observation_id)
        );
        let event = EntityKey::entity("GraphqlCalendarEvent", &["event"]);
        engine
            .put_records_with_projections(
                None,
                vec![(
                    event.clone(),
                    Record {
                        fields: BTreeMap::from([("id".into(), CacheValue::String("event".into()))]),
                    },
                )],
                vec![],
            )
            .await
            .unwrap();
        let dependent = engine.observe_predicate_window(
            spec().query,
            &[],
            None,
            [event.clone()].into_iter().collect(),
        );
        engine
            .calendar_commit(&crate::calendar::CalendarCommit {
                deleted_event_keys: vec![event],
                ..Default::default()
            })
            .await
            .unwrap();
        let unchanged = engine.unchanged_observed_windows().await.unwrap();
        assert!(!unchanged.contains(&dependent));
        assert!(unchanged.contains(&accepted.observation_id));
    });
}

#[test]
fn baseline_members_can_reenter_even_beyond_a_full_indexed_window() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        for id in 0..40 {
            seed(&mut engine, &id.to_string(), id).await;
        }
        seed(&mut engine, "baseline", -10).await;
        engine
            .put_records_with_projections(
                None,
                vec![],
                vec![ProjectionMutation::Replace(projection(
                    "baseline", true, -10,
                ))],
            )
            .await
            .unwrap();
        let mut query = spec();
        query.baseline = vec![PredicateBaselineEntry {
            record_key: PredicateRecordKey::new(key("baseline").to_string()).unwrap(),
            sort_value: -10,
        }];
        let accepted = engine
            .read_live_query("subscription", query.clone(), None)
            .await
            .unwrap();
        assert_eq!(accepted.keys.as_ref().unwrap().len(), 20);
        engine
            .put_records_with_projections(
                None,
                vec![],
                vec![ProjectionMutation::Replace(projection(
                    "baseline", false, -10,
                ))],
            )
            .await
            .unwrap();
        assert!(
            !engine
                .unchanged_observed_windows()
                .await
                .unwrap()
                .contains(&accepted.observation_id)
        );
        let changed = engine
            .read_live_query(
                "subscription",
                query,
                Some(accepted.revision.parse().unwrap()),
            )
            .await
            .unwrap();
        assert!(
            changed
                .keys
                .unwrap()
                .iter()
                .any(|entry| entry.as_str() == key("baseline").as_ref())
        );
    });
}

#[test]
fn continuation_is_bound_to_the_retained_specification() {
    block_on(async {
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        seed(&mut engine, "a", 1).await;
        let initial = engine.read_live_query("view", spec(), None).await.unwrap();
        let revision = initial.revision.parse().unwrap();
        let unchanged = engine
            .resume_live_query("view", initial.registration_id, Some(revision))
            .await
            .unwrap()
            .unwrap();
        assert!(!unchanged.reset);
        assert!(unchanged.upserts.is_empty());
        assert_eq!(unchanged.registration_id, initial.registration_id);
        seed(&mut engine, "b", 2).await;
        let delta = engine
            .resume_live_query("view", initial.registration_id, Some(revision))
            .await
            .unwrap()
            .unwrap();
        assert!(!delta.reset);
        assert_eq!(delta.upserts.len(), 1);
        let mut changed = spec();
        changed.selection = Arc::new(
            RecordSelection::parse(
                crate::meta::bundled_schema_ref(),
                "fragment Item on GraphqlSoupEmailThread { id }",
                "Item",
            )
            .unwrap(),
        );
        let replaced = engine.read_live_query("view", changed, None).await.unwrap();
        assert_ne!(initial.registration_id, replaced.registration_id);
        assert!(
            engine
                .resume_live_query("view", initial.registration_id, None)
                .await
                .unwrap()
                .is_none()
        );
        engine.release_live_query("view");
        assert!(
            engine
                .resume_live_query("view", replaced.registration_id, None)
                .await
                .unwrap()
                .is_none()
        );
    });
}

#[test]
fn evicted_continuations_require_registration_again() {
    block_on(async {
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        let initial = engine.read_live_query("view", spec(), None).await.unwrap();
        for id in 0..VIEW_CAPACITY {
            engine
                .read_live_query(&id.to_string(), spec(), None)
                .await
                .unwrap();
        }
        assert!(
            engine
                .resume_live_query("view", initial.registration_id, None)
                .await
                .unwrap()
                .is_none()
        );
        let registered = engine.read_live_query("view", spec(), None).await.unwrap();
        assert_ne!(initial.registration_id, registered.registration_id);
        assert!(registered.reset);
    });
}

#[test]
fn rotating_subscribers_beyond_one_pane_keep_receiving_deltas() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, "a", 1).await;
        // One channel pane registers about 33 views and reads all of them after
        // every cache write.
        let subscribers = 40;
        let mut cursors = Vec::new();
        for id in 0..subscribers {
            let first = engine
                .read_live_query(&id.to_string(), spec(), None)
                .await
                .unwrap();
            cursors.push(first.revision.parse::<CacheRevision>().unwrap());
        }
        for round in 0..3 {
            seed(&mut engine, &format!("new-{round}"), 10 + round).await;
            for (id, cursor) in cursors.iter_mut().enumerate() {
                let update = engine
                    .read_live_query(&id.to_string(), spec(), Some(*cursor))
                    .await
                    .unwrap();
                assert!(!update.reset, "view {id} was rebuilt in round {round}");
                assert_eq!(update.upserts.len(), 1);
                *cursor = update.revision.parse().unwrap();
            }
        }
    });
}
