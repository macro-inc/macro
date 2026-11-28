use super::*;
use std::sync::Arc;

use cache_core::{
    engine::{Engine, NetworkWrite, live_query::LiveQuerySpec},
    predicate::{ProjectionState, reconciliation::PredicateBaselineEntry},
    record_selection::RecordSelection,
    store::Storage as _,
    value::EntityKey,
};
use cache_turso::{TursoFileDatabase, TursoStorage, TursoStorageCloseOutcome};
use serde_json::json;

const VIEWER: &str = "macro|calls-fixture@example.com";
const CHANNEL: &str = "00000000-0000-0000-0000-00000000000c";
const PUSHED: &str = "00000000-0000-0000-0000-000000000fff";
const STARTED: &str = "2026-01-01T00:00:00.123456Z";
const PAGE: &str = r#"query Soup($input: SoupInput!) {
    user { id soup(input: $input) { nextCursor items {
        __typename id ... on GraphqlSoupCall { status callChannelId: channelId startedAt endedAt }
    } } }
}"#;
const UPDATES: &str = r#"subscription SoupUpdates {
    soupUpdates { __typename ... on SoupUpdated { item {
        __typename id ... on GraphqlSoupCall { status callChannelId: channelId startedAt endedAt }
    } } }
}"#;

fn row(id: &str, status: &str) -> Value {
    json!({"__typename": TYPE, "id": id, "status": status,
        "callChannelId": CHANNEL, "startedAt": STARTED, "endedAt": null})
}

fn filters(call_filter: Option<Value>) -> Value {
    let nil = Uuid::nil().to_string();
    let mut filters = json!({
        "documentFilter":{"literal":{"id":nil}},
        "projectFilter":{"literal":{"projectId":nil}},
        "chatFilter":{"literal":{"chatId":nil}},
        "calendarEventFilter":{"literal":{"id":nil}},
        "emailFilter":{"tree":{"literal":{"threadId":nil}}},
        "channelFilter":{"literal":{"channelId":nil}},
        "channelThreadFilter":{"literal":{"channelId":nil}},
        "crmCompanyFilter":{"literal":{"id":nil}},
        "foreignEntityFilter":{"literal":{"id":nil}},
    });
    if let Some(call_filter) = call_filter {
        filters["callFilter"] = call_filter;
    }
    filters
}

fn compile(filters: Value) -> ValidatedIndexQuery {
    let ast = materialize_graphql_filter(filters).unwrap();
    let LocalCompileOutcome::Supported(query) = facts::compile_call_list(
        &ast,
        SoupFlatRequest {
            sort: SoupIndexSort::UpdatedAt,
            direction: SortDirection::Desc,
            limit: 100,
            has_cursor: false,
        },
    )
    .unwrap() else {
        panic!("expected confined call list");
    };
    query
}

#[test]
fn the_authoritative_call_compiler_does_not_enable_uncovered_host_queries() {
    let filter = filters(Some(json!({"literal": {"status": "MISSED"}})));
    assert_eq!(compile(filter.clone()).as_query().limit, 100);
    assert!(matches!(
        compile_current_filter_request(filter, "UPDATED_AT", "DESC", 100).unwrap(),
        SoupFilterCompileOutcome::Unsupported
    ));
}

fn page(items: Vec<Value>) -> Value {
    json!({"user": {"id": VIEWER, "soup": {"items": items, "nextCursor": null}}})
}

async fn write(
    engine: &mut Engine<TursoStorage>,
    query: &str,
    operation: &str,
    variables: &Map<String, Value>,
    data: &Value,
    legacy: bool,
) {
    let projections = if legacy {
        Vec::new()
    } else {
        let schema = engine.schema_snapshot();
        let core =
            authoritative_projection_mutations(&schema, query, Some(operation), data).unwrap();
        let response = WriteResponse::new(&schema, query, Some(operation), variables, data);
        crate::write_passes(engine, &response, true, core)
            .await
            .unwrap()
    };
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query,
                operation_name: Some(operation),
                variables,
                data,
                identity: Some(VIEWER),
            },
            projections,
        )
        .await
        .unwrap();
}

#[test]
fn legacy_rows_remain_unknown_and_full_pushes_change_each_bounded_list() {
    pollster::block_on(async {
        let all = compile(filters(None));
        let missed = compile(filters(Some(json!({"literal": {"status": "MISSED"}}))));
        let unattended = compile(filters(Some(json!({"literal": {"status": "UNATTENDED"}}))));
        let channel = compile(filters(Some(json!({"literal": {"channelId": CHANNEL}}))));
        let key = RecordKey::new(format!("{TYPE}:{PUSHED}")).unwrap();
        let variables = json!({"input": {"initial": {"limit": 100, "sortMethod": "UPDATED_AT", "filters": filters(None)}}});
        let variables = variables.as_object().unwrap();

        for count in [1_000, 2_000] {
            let directory = tempfile::tempdir().unwrap();
            let database = TursoFileDatabase::new(directory.path().join("calls.turso")).unwrap();
            let mut old = Engine::new(database.open(VIEWER).unwrap());
            for start in (0..count).step_by(100) {
                let rows = (start..start + 100)
                    .map(|i| row(&Uuid::from_u128(i as u128 + 1).to_string(), "MISSED"))
                    .collect();
                write(&mut old, PAGE, "Soup", variables, &page(rows), true).await;
            }
            assert_eq!(
                old.into_storage().try_close().unwrap(),
                TursoStorageCloseOutcome::Healthy
            );

            let open_started = std::time::Instant::now();
            let mut engine = Engine::new(database.open(VIEWER).unwrap());
            let open_elapsed = open_started.elapsed();
            for start in (0..count).step_by(100) {
                let ids: Vec<_> = (start..start + 100)
                    .map(|i| Uuid::from_u128(i as u128 + 1).to_string())
                    .collect();
                let keys: Vec<_> = ids
                    .iter()
                    .map(|id| EntityKey::entity(TYPE, &[id.as_str()]))
                    .collect();
                let rows = engine.storage().get_batch(&keys).await.unwrap();
                assert_eq!(rows.into_iter().flatten().count(), 100);
            }
            let legacy_key = RecordKey::new(format!("{TYPE}:{}", Uuid::from_u128(1))).unwrap();
            let baseline = [PredicateBaselineEntry {
                record_key: legacy_key.clone(),
                sort_value: 1_767_225_600_123_456,
            }];
            let legacy = engine
                .reconcile_predicate_index(&missed, &baseline)
                .await
                .unwrap()
                .value;
            assert_eq!(legacy.keys, vec![legacy_key.clone()]);
            assert_eq!(legacy.retained_keys, vec![legacy_key]);

            let selection = Arc::new(
                RecordSelection::parse(
                    &engine.schema_snapshot(),
                    "fragment CallRow on GraphqlSoupCall { id status }",
                    "CallRow",
                )
                .unwrap(),
            );
            let mut views = [
                ("all", &all),
                ("missed", &missed),
                ("unattended", &unattended),
                ("channel", &channel),
            ]
            .map(|(name, query)| {
                (
                    name,
                    LiveQuerySpec {
                        query: query.clone(),
                        baseline: vec![],
                        selection: selection.clone(),
                    },
                    None,
                    Vec::new(),
                )
            });
            for (name, spec, since, _) in &mut views {
                let update = engine
                    .read_live_query(name, spec.clone(), None)
                    .await
                    .unwrap();
                assert_eq!(update.keys, Some(vec![]));
                *since = Some(update.revision.parse().unwrap());
            }

            for (status, expected) in [
                ("UNATTENDED", [true, false, true, true]),
                ("MISSED", [true, true, false, true]),
                ("ATTENDED", [true, false, false, true]),
            ] {
                let data = json!({"soupUpdates": [{"__typename": "SoupUpdated", "item": row(PUSHED, status)}]});
                write(
                    &mut engine,
                    UPDATES,
                    "SoupUpdates",
                    &Map::new(),
                    &data,
                    false,
                )
                .await;
                for ((name, spec, since, keys), expected) in views.iter_mut().zip(expected) {
                    let update = engine
                        .read_live_query(name, spec.clone(), *since)
                        .await
                        .unwrap();
                    *since = Some(update.revision.parse().unwrap());
                    if let Some(updated_keys) = update.keys {
                        *keys = updated_keys;
                    }
                    assert_eq!(*keys, if expected { vec![key.clone()] } else { vec![] });
                }
            }
            engine
                .delete_keys_with_projections(
                    &[EntityKey::entity(TYPE, &[PUSHED])],
                    std::slice::from_ref(&key),
                )
                .await
                .unwrap();
            for (name, spec, since, keys) in views {
                let update = engine.read_live_query(name, spec, since).await.unwrap();
                assert!(update.keys.unwrap_or(keys).is_empty());
            }
            eprintln!(
                "legacy rows={count}, reopen={open_elapsed:?}, push transitions=4, checked lists=4, server list reads=0"
            );
        }
    });
}

#[test]
fn empty_authoritative_status_page_retires_a_stale_candidate_without_removing_the_record() {
    pollster::block_on(async {
        let filter = filters(Some(json!({"literal": {"status": "MISSED"}})));
        let query = compile(filter.clone());
        let variables = json!({"input": {"initial": {"limit": 100, "sortMethod": "UPDATED_AT", "filters": filter}}});
        let initial = variables.as_object().unwrap();
        let mut engine = Engine::new(TursoStorage::open_in_memory(VIEWER).unwrap());
        let key = RecordKey::new(format!("{TYPE}:{PUSHED}")).unwrap();

        write(
            &mut engine,
            PAGE,
            "Soup",
            initial,
            &page(vec![row(PUSHED, "MISSED")]),
            false,
        )
        .await;
        assert_eq!(
            engine
                .reconcile_predicate_index(&query, &[])
                .await
                .unwrap()
                .value
                .keys,
            vec![key.clone()]
        );

        // An empty response that did not request an expanded call window
        // cannot retire a candidate, even if it has no continuation cursor.
        for (option, value) in [("limit", json!(0)), ("expand", json!(false))] {
            let mut no_window = variables.clone();
            no_window["input"]["initial"][option] = value;
            write(
                &mut engine,
                PAGE,
                "Soup",
                no_window.as_object().unwrap(),
                &page(Vec::new()),
                false,
            )
            .await;
            assert_eq!(
                engine
                    .reconcile_predicate_index(&query, &[])
                    .await
                    .unwrap()
                    .value
                    .keys,
                vec![key.clone()]
            );
        }

        // The viewer missed the update. The next authoritative page excludes
        // the stale match and supplies negative membership evidence.
        write(&mut engine, PAGE, "Soup", initial, &page(Vec::new()), false).await;
        assert!(
            engine
                .reconcile_predicate_index(&query, &[])
                .await
                .unwrap()
                .value
                .keys
                .is_empty()
        );
        let states = engine
            .storage()
            .read_projection_states(&[key])
            .await
            .unwrap();
        assert!(matches!(
            states.as_slice(),
            [Some(ProjectionState::Incomplete {
                kind: ProjectionIncompleteKind::Dirty,
                ..
            })]
        ));
        assert!(
            engine
                .storage()
                .get_batch(&[EntityKey::entity(TYPE, &[PUSHED])])
                .await
                .unwrap()[0]
                .is_some()
        );
    });
}
