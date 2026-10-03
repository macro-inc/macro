use cache_core::engine::{
    BeginOptimisticWrite, Engine, NetworkWrite, QueryRegistration, ReadResult,
};
use cache_core::page_retention::MAX_SOUP_PAGES;
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use serde_json::{Value, json};
use std::collections::BTreeSet;

const QUERY: &str = include_str!("fixtures/viewer_fields.graphql");

fn variables(limit: usize) -> serde_json::Map<String, Value> {
    json!({"input":{"initial":{"limit":limit}}})
        .as_object()
        .unwrap()
        .clone()
}

fn page(id: &str, name: &str, aliased: bool) -> Value {
    let items = json!({"items":[{"__typename":"GraphqlSoupDocument","id":id,"name":name}]});
    if aliased {
        json!({"viewer":{"id":"viewer","page":items}})
    } else {
        json!({"user":{"id":"viewer","soup":items}})
    }
}

async fn write(
    engine: &mut Engine<InMemoryStorage>,
    op: &str,
    vars: &serde_json::Map<String, Value>,
    data: &Value,
    registration: Option<u64>,
) -> BTreeSet<u64> {
    engine
        .write_query_with_registration(
            None,
            registration.map(|op_id| QueryRegistration {
                op_id,
                entity_resolvers: &[],
            }),
            NetworkWrite {
                query: QUERY,
                operation_name: Some(op),
                variables: vars,
                data,
                identity: Some("viewer"),
            },
        )
        .await
        .unwrap()
        .affected_ops
}

#[test]
fn page_changes_only_wake_matching_fields_but_entity_changes_wake_all_readers() {
    pollster::block_on(async {
        for register_on_write in [false, true] {
            for cold in [false, true] {
                let mut engine = Engine::new(InMemoryStorage::new());
                let a = variables(1);
                let b = variables(2);
                let viewer = json!({"user":{"id":"viewer"}});
                for (id, op, vars, data) in [
                    (1, "Page", &a, page("shared", "Original", false)),
                    (2, "Page", &b, page("shared", "Original", false)),
                    (3, "Viewer", &a, viewer),
                    (4, "AliasedPage", &a, page("shared", "Original", true)),
                ] {
                    write(
                        &mut engine,
                        op,
                        vars,
                        &data,
                        register_on_write.then_some(id),
                    )
                    .await;
                }
                if cold {
                    engine = Engine::with_capacity(engine.into_storage(), 1);
                }
                // Cold reopening intentionally loses active registrations; restore via reads.
                if !register_on_write || cold {
                    for (id, op, vars) in [
                        (1, "Page", &a),
                        (2, "Page", &b),
                        (3, "Viewer", &a),
                        (4, "AliasedPage", &a),
                    ] {
                        assert!(matches!(
                            engine
                                .read_query(Some(id), QUERY, Some(op), vars)
                                .await
                                .unwrap(),
                            ReadResult::Hit { .. }
                        ));
                    }
                }
                let changed_page = page("other", "Other", false);
                assert_eq!(
                    write(&mut engine, "Page", &a, &changed_page, None).await,
                    [1, 4].into(),
                    "write={register_on_write}, cold={cold}"
                );
                // A different page can update the same document used by another query.
                let changed_entity = page("shared", "Renamed", false);
                assert_eq!(
                    write(&mut engine, "Page", &a, &changed_entity, None).await,
                    [1, 2, 4].into()
                );
                assert!(
                    write(&mut engine, "Page", &a, &changed_entity, None)
                        .await
                        .is_empty()
                );
                engine.teardown_operation(4);
                assert_eq!(
                    write(&mut engine, "Page", &a, &changed_page, None).await,
                    [1].into()
                );
            }
        }
    });
}

#[test]
fn misses_grouped_pages_and_partial_registrations_keep_safe_dependencies() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let a = variables(1);
        let b = variables(2);
        // An absent viewer must still wake when it first becomes available.
        assert!(matches!(
            engine
                .read_query(Some(1), QUERY, Some("Page"), &a)
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        assert!(
            write(&mut engine, "Page", &a, &page("doc", "Doc", false), None)
                .await
                .contains(&1)
        );
        assert!(matches!(
            engine
                .read_query(Some(2), QUERY, Some("Page"), &b)
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        assert!(
            !write(
                &mut engine,
                "Page",
                &a,
                &page("other", "Other", false),
                None
            )
            .await
            .contains(&2)
        );
        assert!(
            write(&mut engine, "Page", &b, &page("doc", "Doc", false), None)
                .await
                .contains(&2)
        );

        let group = json!({"user":{"id":"viewer","groupSoup":{"bins":[]}}});
        write(&mut engine, "Group", &a, &group, Some(3)).await;
        assert!(
            !write(&mut engine, "Group", &b, &group, None)
                .await
                .contains(&3)
        );
        assert!(
            !write(&mut engine, "Page", &a, &page("doc", "Doc", false), None)
                .await
                .contains(&3)
        );
        // An incomplete network response has no exact dependency proof.
        write(
            &mut engine,
            "Page",
            &a,
            &json!({"user":{"id":"viewer"}}),
            Some(4),
        )
        .await;
        assert!(
            write(
                &mut engine,
                "Page",
                &b,
                &page("other", "Other", false),
                None
            )
            .await
            .contains(&4)
        );
    });
}

#[test]
fn retention_eviction_invalidates_the_removed_page_not_other_pages() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let data = page("shared", "Original", false);
        write(&mut engine, "Page", &variables(0), &data, Some(1)).await;
        for n in 1..MAX_SOUP_PAGES {
            assert!(
                write(&mut engine, "Page", &variables(n), &data, None)
                    .await
                    .is_empty()
            );
        }
        engine
            .read_query(Some(2), QUERY, Some("Page"), &variables(MAX_SOUP_PAGES - 1))
            .await
            .unwrap();
        assert_eq!(
            write(&mut engine, "Page", &variables(MAX_SOUP_PAGES), &data, None).await,
            [1].into()
        );
        assert!(matches!(
            engine
                .read_query(None, QUERY, Some("Page"), &variables(0))
                .await
                .unwrap(),
            ReadResult::Miss
        ));
    });
}

#[test]
fn query_updates_remain_scoped_while_an_optimistic_layer_is_pending() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let a = variables(1);
        let data = page("shared", "Original", false);
        write(&mut engine, "Page", &a, &data, Some(1)).await;
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    uuid: "00000000-0000-4000-8000-000000000001",
                    query: "mutation { setEntityProperty { id } }",
                    operation_name: None,
                    variables: &serde_json::Map::new(),
                    data: &json!({"setEntityProperty":{"id":"pending-property"}}),
                    identity_bindings: &[],
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();
        let result = engine
            .write_query(None, QUERY, Some("Page"), &variables(2), &data, None)
            .await
            .unwrap();
        assert!(result.affected_ops.is_empty());
        assert_eq!(result.search_changed_buckets, Some(BTreeSet::new()));
        assert_eq!(
            write(
                &mut engine,
                "Page",
                &a,
                &page("shared", "Renamed", false),
                None
            )
            .await,
            [1].into()
        );
    });
}

#[test]
fn resets_and_invalidations_still_reexecute_all_affected_readers() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let a = variables(1);
        let b = variables(2);
        write(&mut engine, "Page", &a, &page("doc", "Doc", false), Some(1)).await;
        write(&mut engine, "Page", &b, &page("doc", "Doc", false), Some(2)).await;
        let key = EntityKey::entity("GraphqlUser", &["viewer"]);
        assert_eq!(engine.invalidate_keys([&key]).unwrap().value, [1, 2].into());
        assert_eq!(
            engine.delete_keys(&[key]).await.unwrap().value,
            [1, 2].into()
        );
        let reset = engine
            .write_query(
                None,
                QUERY,
                Some("Viewer"),
                &a,
                &json!({"user":{"id":"other"}}),
                Some("other"),
            )
            .await
            .unwrap();
        assert!(reset.reset);
        assert_eq!(reset.affected_ops, [1, 2].into());
        assert_eq!(reset.search_changed_buckets, None);
    });
}
