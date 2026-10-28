use super::*;
use serde_json::json;

const QUERY: &str = include_str!("hydration_search_changes.graphql");

#[test]
fn ordinary_queries_report_search_changes_but_page_only_writes_do_not() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let variables = serde_json::Map::new();
        let item = json!({"__typename": "GraphqlSoupDocument", "id": "doc", "name": "Note", "fileType": "md"});
        let response = |item| json!({"user": {"id": "viewer", "soup": {"items": [item]}}});
        let data = response(item.clone());
        let result = engine
            .write_query(None, QUERY, None, &variables, &data, None)
            .await
            .unwrap();
        assert_eq!(
            result.search_changed_buckets,
            Some(BTreeSet::from(["note".into()]))
        );
        // Exercise cold before-state comparison and a new argument-qualified page.
        let mut engine = Engine::new(engine.into_storage());
        let other_page = QUERY.replace("limit: 10", "limit: 20");
        let result = engine
            .write_query(None, &other_page, None, &variables, &data, None)
            .await
            .unwrap();
        assert!(result.revision_advanced);
        assert_eq!(result.search_changed_buckets, Some(BTreeSet::new()));
        assert_eq!(
            result.changed,
            BTreeSet::from([EntityKey::entity("GraphqlUser", &["viewer"])])
        );

        let mut renamed = item;
        renamed["name"] = json!("Renamed");
        let result = engine
            .write_query(None, QUERY, None, &variables, &response(renamed), None)
            .await
            .unwrap();
        assert_eq!(
            result.search_changed_buckets,
            Some(BTreeSet::from(["note".into()]))
        );
    });
}

#[test]
fn identity_resets_and_mutations_require_conservative_search_refreshes() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let variables = serde_json::Map::new();
        for id in ["one", "two"] {
            let result = engine
                .write_query(
                    None,
                    "{ user { id } }",
                    None,
                    &variables,
                    &json!({"user":{"id":id}}),
                    Some(id),
                )
                .await
                .unwrap();
            if id == "two" {
                assert!(result.reset);
                assert_eq!(result.search_changed_buckets, None);
            }
        }
        let result = engine
            .write_query(
                None,
                "mutation { setEntityProperty { id } }",
                None,
                &variables,
                &json!({"setEntityProperty":{"id":"property"}}),
                None,
            )
            .await
            .unwrap();
        assert_eq!(result.search_changed_buckets, None);
    });
}
