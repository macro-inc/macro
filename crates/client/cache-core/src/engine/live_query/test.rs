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
