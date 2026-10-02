use super::*;
use crate::{store::InMemoryStorage, value::CacheValue};
use pollster::block_on;
use serde_json::json;

const PAGE: &str = "query Page($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupEmailThread { isRead } } nextCursor } } }";
const DETAIL: &str = "query Detail($id: ID!, $show: Boolean! = true) { user { alias: emailThread(input: {threadId: $id}) { ...Fields @include(if: $show) } } } fragment Fields on GraphqlSoupEmailThread { seen: isRead }";

fn vars() -> serde_json::Map<String, Json> {
    json!({"input": {"initial": {"limit": 1000}}})
        .as_object()
        .unwrap()
        .clone()
}
fn data(count: usize) -> Json {
    json!({"user": {"id": "viewer", "soup": {"items": (0..count).map(|i| json!({
        "__typename": "GraphqlSoupEmailThread", "id": i.to_string(), "isRead": false
    })).collect::<Vec<_>>(), "nextCursor": null}}})
}
async fn seed(engine: &mut Engine<InMemoryStorage>, count: usize) {
    engine
        .write_query(None, PAGE, None, &vars(), &data(count), None)
        .await
        .unwrap();
}
async fn change(engine: &mut Engine<InMemoryStorage>, id: &str, field: &str, value: CacheValue) {
    engine
        .put_records_with_projections(
            None,
            vec![(
                EntityKey::entity("GraphqlSoupEmailThread", &[id]),
                Record {
                    fields: BTreeMap::from([(field.into(), value)]),
                },
            )],
            vec![],
        )
        .await
        .unwrap();
}
fn revision(update: &QueryUpdate) -> CacheRevision {
    match update {
        QueryUpdate::Hit { revision, .. }
        | QueryUpdate::Patch { revision, .. }
        | QueryUpdate::Miss { revision } => revision.parse().unwrap(),
    }
}
fn patches(update: QueryUpdate) -> Json {
    let QueryUpdate::Patch { patches, .. } = update else {
        panic!("expected a patch: {update:?}");
    };
    serde_json::to_value(patches).unwrap()
}

#[test]
fn targets_one_field_in_a_thousand_rows_for_every_subscriber() {
    block_on(async {
        let mut engine = Engine::with_capacity(InMemoryStorage::new(), 1);
        seed(&mut engine, 1000).await;
        let first = engine
            .watch_query(1, PAGE, None, &vars(), &[], None)
            .await
            .unwrap();
        let second = engine
            .watch_query(2, PAGE, None, &vars(), &[], None)
            .await
            .unwrap();
        assert!(matches!(&first, QueryUpdate::Hit { data: result, .. } if *result == data(1000)));
        change(&mut engine, "17", "isRead", CacheValue::Bool(true)).await;
        let before = engine.storage().record_get_count();
        for (op, previous) in [(1, first), (2, second)] {
            let update = engine
                .watch_query(op, PAGE, None, &vars(), &[], Some(revision(&previous)))
                .await
                .unwrap();
            assert_eq!(
                patches(update),
                json!([{"path": ["user", "soup", "items", 17, "isRead"], "value": true}])
            );
        }
        assert!(
            engine.storage().record_get_count() - before <= 2,
            "must not hydrate the other 999 records"
        );
    });
}

#[test]
fn aliases_fragments_defaults_and_synthetic_relations_need_no_selected_identity() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, 1).await;
        let variables = json!({"id": "0"}).as_object().unwrap().clone();
        let resolvers = vec![EntityResolver {
            parent_type: "GraphqlUser".into(),
            field_name: "emailThread".into(),
            target_type: "GraphqlSoupEmailThread".into(),
            argument_path: vec!["input".into(), "threadId".into()],
        }];
        let first = engine
            .watch_query(1, DETAIL, None, &variables, &resolvers, None)
            .await
            .unwrap();
        assert!(
            matches!(&first, QueryUpdate::Hit { data, .. } if *data == json!({"user":{"alias":{"seen":false}}}))
        );
        change(&mut engine, "0", "isRead", CacheValue::Bool(true)).await;
        let update = engine
            .watch_query(
                1,
                DETAIL,
                None,
                &variables,
                &resolvers,
                Some(revision(&first)),
            )
            .await
            .unwrap();
        assert_eq!(
            patches(update),
            json!([{"path":["user","alias","seen"],"value":true}])
        );
        let mut hidden = variables;
        hidden.insert("show".into(), json!(false));
        let update = engine
            .watch_query(
                1,
                DETAIL,
                None,
                &hidden,
                &resolvers,
                Some(engine.current_revision()),
            )
            .await
            .unwrap();
        assert!(
            matches!(update, QueryUpdate::Hit { data, .. } if data == json!({"user":{"alias":{}}}))
        );
    });
}

#[test]
fn structural_edits_rebuild_paths_and_tombstones_cannot_patch_stale_indices() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, 2).await;
        let initial = engine
            .watch_query(1, PAGE, None, &vars(), &[], None)
            .await
            .unwrap();
        let mut reordered = data(2);
        reordered["user"]["soup"]["items"]
            .as_array_mut()
            .unwrap()
            .reverse();
        engine
            .write_query(None, PAGE, None, &vars(), &reordered, None)
            .await
            .unwrap();
        let replacement = engine
            .watch_query(1, PAGE, None, &vars(), &[], Some(revision(&initial)))
            .await
            .unwrap();
        assert!(matches!(&replacement, QueryUpdate::Hit { data, .. } if *data == reordered));
        change(&mut engine, "0", "isRead", CacheValue::Bool(true)).await;
        let next = engine
            .watch_query(1, PAGE, None, &vars(), &[], Some(revision(&replacement)))
            .await
            .unwrap();
        let cursor = revision(&next);
        assert_eq!(
            patches(next),
            json!([{"path":["user","soup","items",1,"isRead"],"value":true}])
        );
        change(
            &mut engine,
            "1",
            identity::DELETED_FIELD,
            CacheValue::Bool(true),
        )
        .await;
        let deleted = engine
            .watch_query(1, PAGE, None, &vars(), &[], Some(cursor))
            .await
            .unwrap();
        assert!(
            matches!(&deleted, QueryUpdate::Hit { data, .. } if data["user"]["soup"]["items"].as_array().unwrap().len() == 1)
        );
        change(&mut engine, "0", "isRead", CacheValue::Bool(false)).await;
        let after = engine
            .watch_query(1, PAGE, None, &vars(), &[], Some(revision(&deleted)))
            .await
            .unwrap();
        assert!(
            matches!(after, QueryUpdate::Hit { data, .. } if data["user"]["soup"]["items"][0]["isRead"] == false)
        );
    });
}

#[test]
fn stale_cursors_teardown_eviction_and_generation_changes_get_replacements() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, 1).await;
        let first = engine
            .watch_query(1, PAGE, None, &vars(), &[], None)
            .await
            .unwrap();
        assert!(matches!(
            engine
                .watch_query(1, PAGE, None, &vars(), &[], Some(CacheRevision::ZERO))
                .await
                .unwrap(),
            QueryUpdate::Hit { .. }
        ));
        engine.teardown_operation(1);
        assert!(engine.query_watches.views.is_empty());
        for op in 2..(WATCH_CAPACITY as u64 + 4) {
            engine
                .watch_query(op, PAGE, None, &vars(), &[], None)
                .await
                .unwrap();
        }
        assert!(engine.query_watches.views.len() <= WATCH_CAPACITY);
        assert!(matches!(
            engine
                .watch_query(2, PAGE, None, &vars(), &[], Some(revision(&first)))
                .await
                .unwrap(),
            QueryUpdate::Hit { .. }
        ));
        engine.external_reset().unwrap();
        assert!(engine.query_watches.views.is_empty());
        assert!(matches!(
            engine
                .watch_query(2, PAGE, None, &vars(), &[], Some(revision(&first)))
                .await
                .unwrap(),
            QueryUpdate::Hit { .. }
        ));
    });
}

#[test]
fn skipped_fields_do_not_resurface_and_repeated_fragment_selections_merge() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, 1).await;
        let query = "query { user { id ...More } } fragment More on GraphqlUser { soup(input:{initial:{limit:1000}}) { items { id __typename ... on GraphqlSoupEmailThread { isRead @skip(if:true) } } } }";
        let first = engine
            .watch_query(1, query, None, &serde_json::Map::new(), &[], None)
            .await
            .unwrap();
        assert!(
            matches!(&first, QueryUpdate::Hit { data, .. } if data["user"]["id"] == "viewer" && data["user"]["soup"]["items"][0].get("isRead").is_none())
        );
        change(&mut engine, "0", "isRead", CacheValue::Bool(true)).await;
        assert_eq!(
            patches(
                engine
                    .watch_query(
                        1,
                        query,
                        None,
                        &serde_json::Map::new(),
                        &[],
                        Some(revision(&first))
                    )
                    .await
                    .unwrap()
            ),
            json!([])
        );
        let merged =
            "query { user { id } user { soup(input:{initial:{limit:1000}}) { nextCursor } } }";
        assert!(
            matches!(engine.watch_query(2, merged, None, &serde_json::Map::new(), &[], None).await.unwrap(), QueryUpdate::Hit { data, .. } if data == json!({"user":{"id":"viewer","soup":{"nextCursor":null}}}))
        );
    });
}

#[test]
fn overlapping_optimism_and_rollback_use_the_effective_value() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        seed(&mut engine, 1).await;
        let initial = engine
            .watch_query(1, PAGE, None, &vars(), &[], None)
            .await
            .unwrap();
        let variables = json!({"input":{"threadId":"0"}})
            .as_object()
            .unwrap()
            .clone();
        let mut cursor = revision(&initial);
        for (uuid, read) in [
            ("00000000-0000-4000-8000-000000000001", true),
            ("00000000-0000-4000-8000-000000000002", false),
        ] {
            engine.begin_optimistic_write(None, BeginOptimisticWrite {
                uuid, query: "mutation Read($input: MarkEmailThreadSeenInput!) { markEmailThreadSeen(input:$input) { id isRead } }",
                operation_name: None, variables: &variables, data: &json!({"markEmailThreadSeen":{"id":"0","isRead":read}}),
                link_patches: &[], revalidations: &[], identity_bindings: &[], created_at_ms: 0,
            }).await.unwrap();
            let update = engine
                .watch_query(1, PAGE, None, &vars(), &[], Some(cursor))
                .await
                .unwrap();
            cursor = revision(&update);
            assert_eq!(patches(update)[0]["value"], read);
        }
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
                claim.queued.id,
                MutationClaimToken {
                    owner: "test".into(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
        let update = engine
            .watch_query(1, PAGE, None, &vars(), &[], Some(cursor))
            .await
            .unwrap();
        assert_eq!(
            patches(update),
            json!([]),
            "rolling back the older layer cannot undo the newer layer"
        );
    });
}

#[test]
fn network_identity_aliases_and_default_arguments_round_trip() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let query = "query Aliased($input: SoupInput! = {initial:{limit:2}}) { viewer:user { key:id page:soup(input:$input) { items { kind:__typename key:id ...on GraphqlSoupEmailThread { seen:isRead } } } } }";
        let data = json!({"viewer":{"key":"viewer","page":{"items":[{"kind":"GraphqlSoupEmailThread","key":"0","seen":false}]}}});
        let variables = serde_json::Map::new();
        engine
            .write_query(None, query, None, &variables, &data, None)
            .await
            .unwrap();
        let first = engine
            .watch_query(1, query, None, &variables, &[], None)
            .await
            .unwrap();
        assert!(matches!(&first, QueryUpdate::Hit { data: actual, .. } if *actual == data));
        change(&mut engine, "0", "isRead", CacheValue::Bool(true)).await;
        let next = engine
            .watch_query(1, query, None, &variables, &[], Some(revision(&first)))
            .await
            .unwrap();
        assert_eq!(
            patches(next),
            json!([{"path":["viewer","page","items",0,"seen"],"value":true}])
        );
    });
}

#[test]
fn account_changes_discard_query_bindings_and_old_entities() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(None, PAGE, None, &vars(), &data(2), Some("account-a"))
            .await
            .unwrap();
        let first = engine
            .watch_query(1, PAGE, None, &vars(), &[], None)
            .await
            .unwrap();
        let mut next = data(0);
        next["user"]["id"] = json!("other-viewer");
        engine
            .write_query(None, PAGE, None, &vars(), &next, Some("account-b"))
            .await
            .unwrap();
        assert!(engine.query_watches.views.is_empty());
        let result = engine
            .watch_query(1, PAGE, None, &vars(), &[], Some(revision(&first)))
            .await
            .unwrap();
        assert!(matches!(result, QueryUpdate::Hit { data, .. } if data == next));
    });
}
