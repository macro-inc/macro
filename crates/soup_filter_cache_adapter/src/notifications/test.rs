use super::*;
use cache_core::{
    engine::{BeginOptimisticWrite, Engine, NetworkWrite},
    predicate::{PredicateIndexStorage, PredicateQueryResult, ProjectionState},
    queue::{MutationClaimRequest, MutationClaimToken},
    store::InMemoryStorage,
};
use predicate_index::{
    IndexQuery, PartitionPredicate, PredicateExpr, SortDirection, ValidatedIndexQuery,
};
use serde_json::{Value, json};
use soup_filter_projection::{SoupCacheProjectionSupplement, encode_cache_projection_supplement};

const D: &str = "00000000-0000-0000-0000-000000000001";
const A: &str = "00000000-0000-0000-0000-000000000011";
const B: &str = "00000000-0000-0000-0000-000000000012";
const C: &str = "00000000-0000-0000-0000-000000000013";
const SNAPSHOT: &str = r#"query Snapshot { user { id soup(input: { initial: { limit: 20 } }) { items { __typename id cacheProjection notifications { id entityId entityType state } ... on GraphqlSoupDocument { ownerId projectId fileType subType { __typename } createdAt updatedAt } } } } }"#;
const UPDATE: &str = r#"mutation Update($input: UpdateNotificationsInput!) { updateNotifications(input: $input) { id entityId entityType state } }"#;

fn notification(id: &str, state: &str) -> Value {
    json!({"__typename":"GraphqlNotification", "id":id, "entityType":"DOCUMENT", "entityId":D, "state":state})
}
fn snapshot(notifications: Vec<Value>) -> Value {
    let capsule = encode_cache_projection_supplement(&SoupCacheProjectionSupplement::document(
        RecordKey::new(format!("GraphqlSoupDocument:{D}")).unwrap(),
        false,
        true,
        vec![],
    ))
    .unwrap();
    json!({"user":{"id":"macro|viewer@example.com", "soup":{"items":[{"__typename":"GraphqlSoupDocument", "id":D, "cacheProjection":capsule, "ownerId":"macro|viewer@example.com", "projectId":null, "fileType":"md", "subType":null, "createdAt":"2025-01-01T00:00:00Z", "updatedAt":"2025-01-02T00:00:00Z", "notifications":notifications}]}}})
}
fn variables() -> serde_json::Map<String, Value> {
    json!({"input":{"notificationIds":[A], "operation":"MARK_DONE"}})
        .as_object()
        .unwrap()
        .clone()
}
async fn write<S: Storage>(engine: &mut Engine<S>, query: &str, data: &Value) {
    let vars = variables();
    let mut projections = authoritative_projection_mutations(query, None, data).unwrap();
    projections.extend(
        notification_projection_updates(engine.storage(), query, None, &vars, data)
            .await
            .unwrap(),
    );
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query,
                operation_name: None,
                variables: &vars,
                data,
                identity: Some("viewer"),
            },
            projections,
        )
        .await
        .unwrap();
}
fn query(predicate: PredicateExpr) -> ValidatedIndexQuery {
    ValidatedIndexQuery::new(IndexQuery {
        profile: vocabulary::profile_v4(),
        partitions: vec![PartitionPredicate {
            partition: vocabulary::document_partition(),
            predicate,
        }],
        sort_attribute: vocabulary::updated_at(),
        sort_direction: SortDirection::Desc,
        tie_break_direction: SortDirection::Desc,
        limit: 20,
    })
    .unwrap()
}
fn unseen() -> PredicateExpr {
    PredicateExpr::ExactExists {
        attribute: vocabulary::notification_unseen(),
    }
}
fn seen() -> PredicateExpr {
    PredicateExpr::ExactExists {
        attribute: vocabulary::notification_seen(),
    }
}
async fn matches<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    predicate: PredicateExpr,
) -> bool {
    let result = engine
        .query_predicate_index(&query(predicate))
        .await
        .unwrap()
        .value;
    match result {
        PredicateQueryResult::Complete(keys) | PredicateQueryResult::Optimistic(keys) => {
            !keys.is_empty()
        }
        other => panic!("unexpected {other:?}"),
    }
}
async fn mark_done<S: Storage>(engine: &mut Engine<S>, id: &str, uuid: &str) -> u64 {
    let data = json!({"updateNotifications":[{"__typename":"GraphqlNotification", "id":id, "state":"DONE"}]});
    let vars = variables();
    let updates = optimistic_notification_updates(
        notification_projection_updates(engine.storage(), UPDATE, None, &vars, &data)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(updates.len(), 1);
    engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                uuid,
                query: UPDATE,
                operation_name: None,
                variables: &vars,
                data: &data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
            },
            updates,
        )
        .await
        .unwrap()
        .0
}
async fn claim<S: Storage>(engine: &mut Engine<S>, expected: u64) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 1,
            lease_expires_at_ms: 1000,
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.queued.id, expected);
    MutationClaimToken {
        owner: "test".into(),
        generation: claimed.lease_generation,
    }
}

async fn lifecycle<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    write(
        &mut engine,
        SNAPSHOT,
        &snapshot(vec![notification(A, "UNSEEN"), notification(B, "UNSEEN")]),
    )
    .await;
    assert!(matches(&mut engine, unseen()).await);
    assert!(!matches(&mut engine, seen()).await);
    let first = mark_done(&mut engine, A, "00000000-0000-0000-0000-000000000101").await;
    assert!(matches(&mut engine, unseen()).await);
    let second = mark_done(&mut engine, B, "00000000-0000-0000-0000-000000000102").await;
    assert!(!matches(&mut engine, unseen()).await);
    // Durable reopen restores both independent member edits.
    let mut engine = Engine::new(engine.into_storage());
    assert!(!matches(&mut engine, unseen()).await);
    let token = claim(&mut engine, first).await;
    engine
        .rollback_optimistic_write(first, token)
        .await
        .unwrap();
    assert!(
        matches(&mut engine, unseen()).await,
        "A restored while B remains done"
    );
    // Realtime changes authority underneath B's pending member removal.
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[notification(A,"SEEN")]}),
    )
    .await;
    assert!(!matches(&mut engine, unseen()).await);
    assert!(matches(&mut engine, seen()).await);
    // New notification was never a member of the original display edge.
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[notification(C,"UNSEEN")]}),
    )
    .await;
    assert!(
        matches(
            &mut engine,
            PredicateExpr::And(Box::new(unseen()), Box::new(seen()))
        )
        .await
    );
    // Refetch must preserve B's pending mark-done, not restore stale membership.
    write(
        &mut engine,
        SNAPSHOT,
        &snapshot(vec![
            notification(A, "SEEN"),
            notification(B, "UNSEEN"),
            notification(C, "UNSEEN"),
        ]),
    )
    .await;
    let token = claim(&mut engine, second).await;
    let data = json!({"updateNotifications":[notification(B,"DONE")]});
    let projections =
        notification_projection_updates(engine.storage(), UPDATE, None, &variables(), &data)
            .await
            .unwrap();
    engine
        .commit_optimistic_write_with_projections(
            second,
            token,
            UPDATE,
            None,
            &variables(),
            &data,
            projections,
        )
        .await
        .unwrap();
    let key = format!("GraphqlNotification:{C}");
    let projections =
        notification_deletion_updates(engine.storage(), std::slice::from_ref(&key), false)
            .await
            .unwrap();
    engine
        .delete_keys_with_projection_changes(&[EntityKey(key.into())], projections)
        .await
        .unwrap();
    assert!(!matches(&mut engine, unseen()).await);
    // Active-edge refresh omits done B. Reopen must insert B without that edge link.
    write(
        &mut engine,
        SNAPSHOT,
        &snapshot(vec![notification(A, "SEEN")]),
    )
    .await;
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[notification(A,"DONE")]}),
    )
    .await;
    assert!(!matches(&mut engine, seen()).await);
    write(
        &mut engine,
        UPDATE,
        &json!({"updateNotifications":[notification(B,"SEEN")]}),
    )
    .await;
    assert!(matches(&mut engine, seen()).await);
    assert!(matches(&mut engine, PredicateExpr::Not(Box::new(unseen()))).await);
    // A different viewer cannot inherit notification facts or pending layers.
    engine
        .write_query(
            None,
            SNAPSHOT,
            None,
            &variables(),
            &snapshot(vec![]),
            Some("other-viewer"),
        )
        .await
        .unwrap();
    assert!(!matches(&mut engine, seen()).await);
}

#[test]
fn member_lifecycle_in_memory() {
    pollster::block_on(lifecycle(InMemoryStorage::new()));
}
#[test]
fn member_lifecycle_real_turso() {
    pollster::block_on(async {
        lifecycle(cache_turso::TursoStorage::open_in_memory("notification-members").unwrap()).await
    });
}

async fn unhydrated_parents<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let local_query = ValidatedIndexQuery::new(IndexQuery {
        profile: vocabulary::profile_v4(),
        partitions: [
            vocabulary::document_partition(),
            vocabulary::project_partition(),
            vocabulary::chat_partition(),
        ]
        .into_iter()
        .map(|partition| PartitionPredicate {
            partition,
            predicate: PredicateExpr::All,
        })
        .collect(),
        sort_attribute: vocabulary::updated_at(),
        sort_direction: SortDirection::Desc,
        tie_break_direction: SortDirection::Desc,
        limit: 20,
    })
    .unwrap();
    let hydrated_key = RecordKey::new(format!("GraphqlSoupDocument:{D}")).unwrap();
    for (kind, typename) in [
        ("DOCUMENT", "GraphqlSoupDocument"),
        ("PROJECT", "GraphqlSoupProject"),
        ("CHAT", "GraphqlSoupChat"),
    ] {
        let parent_key = RecordKey::new(format!("{typename}:{B}")).unwrap();
        let mut secondary = notification(A, "UNSEEN");
        secondary["entityId"] = json!(B);
        secondary["entityType"] = json!(kind);
        // The display edge hydrates D, not this notification's primary parent.
        write(&mut engine, SNAPSHOT, &snapshot(vec![secondary.clone()])).await;
        assert_eq!(
            engine
                .query_predicate_index(&local_query)
                .await
                .unwrap()
                .value,
            PredicateQueryResult::Complete(vec![hydrated_key.clone()]),
            "secondary {kind} must not force unrelated lists to fall back"
        );
        assert!(!matches(&mut engine, unseen()).await);

        // A mixed inbox response must still patch hydrated primary parents.
        write(
            &mut engine,
            UPDATE,
            &json!({"updateNotifications":[secondary.clone(), notification(C, "SEEN")]}),
        )
        .await;
        assert!(matches(&mut engine, seen()).await);
        assert!(!matches(&mut engine, unseen()).await);
        for state in ["DONE", "UNSEEN", "INVALID"] {
            let data = json!({"updateNotifications":[{"__typename":"GraphqlNotification", "id":A, "state":state}]});
            let updates = notification_projection_updates(
                engine.storage(),
                UPDATE,
                None,
                &variables(),
                &data,
            )
            .await
            .unwrap();
            assert!(updates.is_empty(), "ID-only {kind} update: {state}");
            assert!(optimistic_notification_updates(updates).unwrap().is_empty());
            write(&mut engine, UPDATE, &data).await;
        }
        let keys = vec![format!("GraphqlNotification:{A}")];
        for invalidate in [false, true] {
            assert!(
                notification_deletion_updates(engine.storage(), &keys, invalidate)
                    .await
                    .unwrap()
                    .is_empty(),
                "deletion/invalidation must not introduce {kind} projection state"
            );
        }
        assert_eq!(
            engine
                .storage()
                .load_projection_states(&[parent_key])
                .await
                .unwrap(),
            vec![None]
        );
        // Identity is retained: reassociation can add to and remove from D,
        // without introducing a projection for the unhydrated next parent.
        write(
            &mut engine,
            UPDATE,
            &json!({"updateNotifications":[notification(A, "UNSEEN")]}),
        )
        .await;
        assert!(matches(&mut engine, unseen()).await);
        write(
            &mut engine,
            UPDATE,
            &json!({"updateNotifications":[secondary]}),
        )
        .await;
        assert!(!matches(&mut engine, unseen()).await);
        assert!(matches(&mut engine, seen()).await);
        let mut reopened = Engine::new(engine.into_storage());
        assert_eq!(
            reopened
                .query_predicate_index(&local_query)
                .await
                .unwrap()
                .value,
            PredicateQueryResult::Complete(vec![hydrated_key.clone()])
        );
        engine = reopened;
    }
}

#[test]
fn unhydrated_notification_parents_in_memory() {
    pollster::block_on(unhydrated_parents(InMemoryStorage::new()));
}

#[test]
fn unhydrated_notification_parents_real_turso() {
    pollster::block_on(async {
        unhydrated_parents(
            cache_turso::TursoStorage::open_in_memory("unhydrated-notification-parents").unwrap(),
        )
        .await
    });
}

async fn nonmatching_parent_projections<S: Storage>(mut storage: S) {
    let mutations = authoritative_projection_mutations(SNAPSHOT, None, &snapshot(vec![])).unwrap();
    let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
        panic!("complete base")
    };
    let mut old_profile = document.clone();
    old_profile.profile = vocabulary::profile_v3();
    let mut wrong_partition = document.clone();
    wrong_partition.partition = vocabulary::project_partition();
    let mut bases = vec![
        ProjectionMutation::Replace(old_profile),
        ProjectionMutation::Replace(wrong_partition),
    ];
    bases.extend(
        [
            ProjectionIncompleteKind::Missing,
            ProjectionIncompleteKind::Dirty,
            ProjectionIncompleteKind::IncompatibleVersion,
        ]
        .into_iter()
        .map(|kind| ProjectionMutation::MarkIncomplete {
            record_key: document.record_key.clone(),
            profile: document.profile.clone(),
            partition: document.partition.clone(),
            kind,
        }),
    );
    for base in bases {
        storage
            .put_batch_with_projections(vec![], vec![base])
            .await
            .unwrap();
        let before = storage
            .load_projection_states(std::slice::from_ref(&document.record_key))
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        write(
            &mut engine,
            UPDATE,
            &json!({"updateNotifications":[notification(A, "UNSEEN")]}),
        )
        .await;
        let keys = vec![format!("GraphqlNotification:{A}")];
        for invalidate in [false, true] {
            assert!(
                notification_deletion_updates(engine.storage(), &keys, invalidate)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
        assert_eq!(
            engine
                .storage()
                .load_projection_states(std::slice::from_ref(&document.record_key))
                .await
                .unwrap(),
            before,
            "notification rows must neither promote incomplete parents nor overwrite other profiles/partitions"
        );
        storage = engine.into_storage();
    }
}

#[test]
fn nonmatching_notification_parent_projections_in_memory() {
    pollster::block_on(nonmatching_parent_projections(InMemoryStorage::new()));
}

#[test]
fn nonmatching_notification_parent_projections_real_turso() {
    pollster::block_on(async {
        nonmatching_parent_projections(
            cache_turso::TursoStorage::open_in_memory("nonmatching-notification-parents").unwrap(),
        )
        .await
    });
}

#[test]
fn optimistic_notification_conversion_preserves_member_edits_and_invalidation() {
    let key = RecordKey::new(format!("GraphqlSoupDocument:{D}")).unwrap();
    let partition = vocabulary::document_partition();
    let id = uuid::Uuid::parse_str(A).unwrap();
    assert!(optimistic_notification_updates(vec![]).unwrap().is_empty());
    assert_eq!(
        optimistic_notification_updates(vec![
            change(key.clone(), partition.clone(), id, Some("SEEN")),
            change(key.clone(), partition.clone(), id, Some("INVALID")),
        ])
        .unwrap(),
        vec![
            OptimisticProjectionMutation::PatchExact {
                record_key: key.clone(),
                profile: vocabulary::profile_v4(),
                partition: partition.clone(),
                remove: vec![
                    member(vocabulary::notification_unseen(), id),
                    member(vocabulary::notification_seen(), id),
                ],
                insert: vec![member(vocabulary::notification_seen(), id)],
            },
            OptimisticProjectionMutation::Unknown {
                record_key: key,
                profile: vocabulary::profile_v4(),
                partition,
                affected_attributes: vec![
                    vocabulary::notification_unseen(),
                    vocabulary::notification_seen(),
                ],
            },
        ]
    );
}

#[test]
fn optimistic_notification_conversion_rejects_unsupported_mutations() {
    let mutations = authoritative_projection_mutations(SNAPSHOT, None, &snapshot(vec![])).unwrap();
    let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
        panic!("complete snapshot")
    };
    for unsupported in [
        ProjectionMutation::Replace(document.clone()),
        ProjectionMutation::Patch {
            record_key: document.record_key.clone(),
            profile: document.profile.clone(),
            partition: document.partition.clone(),
            exact: vec![],
            integers: vec![],
            sorts: vec![],
        },
        ProjectionMutation::Delete(document.record_key.clone()),
    ] {
        // A supported prefix must not hide an unsupported mutation in the batch.
        let supported = change(
            document.record_key.clone(),
            document.partition.clone(),
            uuid::Uuid::parse_str(A).unwrap(),
            Some("DONE"),
        );
        let error = optimistic_notification_updates(vec![supported, unsupported]).unwrap_err();
        assert_eq!(
            error.to_string(),
            "notification updates must be member edits or invalidation"
        );
    }
}

#[test]
fn snapshot_completeness_aliases_primary_scope_and_bounds() {
    let data = snapshot(vec![notification(A, "UNSEEN"), notification(B, "SEEN")]);
    let mutations = authoritative_projection_mutations(SNAPSHOT, None, &data).unwrap();
    let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
        panic!("complete snapshot")
    };
    assert!(document.matches(&unseen()) && document.matches(&seen()));
    for missing in ["state", "entityId", "entityType", "id"] {
        let mut data = data.clone();
        data["user"]["soup"]["items"][0]["notifications"][0]
            .as_object_mut()
            .unwrap()
            .remove(missing);
        assert!(matches!(
            authoritative_projection_mutations(SNAPSHOT, None, &data)
                .unwrap()
                .as_slice(),
            [ProjectionMutation::MarkIncomplete { .. }]
        ));
    }
    let mut omitted = data.clone();
    omitted["user"]["soup"]["items"][0]
        .as_object_mut()
        .unwrap()
        .remove("notifications");
    assert!(matches!(
        authoritative_projection_mutations(SNAPSHOT, None, &omitted)
            .unwrap()
            .as_slice(),
        [ProjectionMutation::MarkIncomplete { .. }]
    ));
    let mut secondary = notification(A, "UNSEEN");
    secondary["entityId"] = json!(B);
    let mutations =
        authoritative_projection_mutations(SNAPSHOT, None, &snapshot(vec![secondary])).unwrap();
    let [ProjectionMutation::Replace(document)] = mutations.as_slice() else {
        panic!("complete secondary edge")
    };
    assert!(!document.matches(&unseen()));
    let alias_query = SNAPSHOT.replace(
        "notifications { id entityId entityType state }",
        "notifs: notifications { id entityId entityType lifecycle: state }",
    );
    let mut alias_data = data.clone();
    let entity = alias_data["user"]["soup"]["items"][0]
        .as_object_mut()
        .unwrap();
    let mut rows = entity.remove("notifications").unwrap();
    for row in rows.as_array_mut().unwrap() {
        let row = row.as_object_mut().unwrap();
        let state = row.remove("state").unwrap();
        row.insert("lifecycle".into(), state);
    }
    entity.insert("notifs".into(), rows);
    assert_eq!(
        authoritative_projection_mutations(alias_query.as_str(), None, &alias_data).unwrap(),
        authoritative_projection_mutations(SNAPSHOT, None, &data).unwrap()
    );
    let too_many = (1..=256)
        .map(|n| notification(&uuid::Uuid::from_u128(n + 1000).to_string(), "UNSEEN"))
        .collect();
    assert!(matches!(
        authoritative_projection_mutations(SNAPSHOT, None, &snapshot(too_many))
            .unwrap()
            .as_slice(),
        [ProjectionMutation::MarkIncomplete { .. }]
    ));
}

#[test]
fn compiler_supports_active_states_for_each_indexed_partition_but_rejects_done() {
    let nil = uuid::Uuid::nil().to_string();
    let base = json!({
        "calendarEventFilter":{"literal":{"id":nil}},
        "documentFilter":{"literal":{"id":nil}},
        "projectFilter":{"literal":{"projectIdSelf":nil}},
        "chatFilter":{"literal":{"chatId":nil}},
        "emailFilter":{"tree":{"literal":{"threadId":nil}}},
        "channelFilter":{"literal":{"channelId":nil}},
        "channelThreadFilter":{"literal":{"threadId":nil}},
        "callFilter":{"literal":{"callId":nil}},
        "crmCompanyFilter":{"literal":{"id":nil}},
        "foreignEntityFilter":{"literal":{"id":nil}}
    });
    for field in ["documentFilter", "projectFilter", "chatFilter"] {
        for state in ["UNSEEN", "SEEN", "DONE"] {
            for negated in [false, true] {
                let mut filters = base.clone();
                let expr = json!({"literal":{"notificationState":state}});
                filters[field] = if negated { json!({"not":expr}) } else { expr };
                let outcome = compile_filter_request(filters, "UPDATED_AT", "DESC", 20).unwrap();
                assert_eq!(
                    matches!(outcome, SoupFilterCompileOutcome::Supported(_)),
                    state != "DONE",
                    "{field} {state} not={negated}"
                );
            }
        }
    }
}

#[test]
fn seen_and_reopen_identity_only_optimism_do_not_guess_state() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(
            &mut engine,
            SNAPSHOT,
            &snapshot(vec![notification(A, "UNSEEN")]),
        )
        .await;
        let data = json!({"updateNotifications":[{"__typename":"GraphqlNotification","id":A}]});
        assert!(
            notification_projection_updates(engine.storage(), UPDATE, None, &variables(), &data)
                .await
                .unwrap()
                .is_empty()
        );
        let keys = vec![format!("GraphqlNotification:{A}")];
        let updates = notification_deletion_updates(engine.storage(), &keys, true)
            .await
            .unwrap();
        engine.mark_projections_incomplete(updates).await.unwrap();
        let state = engine
            .storage()
            .load_projection_states(&[RecordKey::new(format!("GraphqlSoupDocument:{D}")).unwrap()])
            .await
            .unwrap();
        assert!(matches!(state[0], Some(ProjectionState::Incomplete { .. })));
    });
}
