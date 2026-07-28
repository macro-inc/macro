//! Generated-query cache inspection integration tests.

use cache_core::engine::{BeginOptimisticWrite, Engine};
use cache_core::link_patch::{
    LinkOperation, LinkPathSegment, ListItemByScalar, OptimisticLinkPatch,
};
use cache_core::query_inspection::{MAX_INSPECTED_VARIANTS, QueryInspection, QueryInspectionError};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const GROUP_QUERY: &str = r#"
query GroupViews($input: GroupedSoupInput!) {
  user {
    id
    groupSoup(input: $input) {
      bins { key nextCursor items { __typename id } }
    }
  }
}
"#;

const SHORT_GROUP_QUERY: &str = r#"
query GroupViews($input: GroupedSoupInput!) {
  user { id groupSoup(input: $input) { bins { key items { __typename id } } } }
}
"#;

fn object(value: Json) -> serde_json::Map<String, Json> {
    let Json::Object(value) = value else {
        unreachable!()
    };
    value
}

fn initial(limit: usize) -> serde_json::Map<String, Json> {
    object(json!({"input": {"initial": {
        "groupBy": {"field": "PROPERTY", "propertyDefinitionId": "status-def"},
        "limit": limit
    }}}))
}

fn continuation(cursor: &str) -> serde_json::Map<String, Json> {
    object(json!({"input": {"continuation": {
        "groupBy": {"field": "PROPERTY", "propertyDefinitionId": "status-def"},
        "groupKey": "in-progress",
        "cursor": cursor
    }}}))
}

fn page(item: &str, next_cursor: Option<&str>) -> Json {
    json!({"user": {"id": "user-1", "groupSoup": {"bins": [{
        "key": "in-progress",
        "nextCursor": next_cursor,
        "items": [{"__typename": "GraphqlSoupDocument", "id": item}]
    }]}}})
}

fn inspection(query: &str, path: &[&str]) -> QueryInspection {
    QueryInspection {
        query: query.to_string(),
        operation_name: Some("GroupViews".to_string()),
        path: path.iter().map(|part| (*part).to_string()).collect(),
    }
}

async fn write_group(
    engine: &mut Engine<InMemoryStorage>,
    query: &str,
    variables: &serde_json::Map<String, Json>,
    data: &Json,
) {
    engine
        .write_query(None, query, Some("GroupViews"), variables, data, None)
        .await
        .unwrap();
}

#[test]
fn enumerates_variants_aliases_and_misses_in_canonical_order() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write_group(
            &mut engine,
            GROUP_QUERY,
            &initial(20),
            &page("task-1", None),
        )
        .await;
        write_group(
            &mut engine,
            GROUP_QUERY,
            &continuation("cursor-1"),
            &page("task-2", Some("cursor-2")),
        )
        .await;
        // This creates a third `groupSoup` variant, but not enough selected
        // fields for the full inspection query to be a hit.
        write_group(
            &mut engine,
            SHORT_GROUP_QUERY,
            &initial(50),
            &page("task-3", None),
        )
        .await;

        // A different schema field on the same normalized user is ignored.
        let soup_query =
            "query Soup($input: SoupInput!) { user { id soup(input: $input) { hasMore } } }";
        engine
            .write_query(
                None,
                soup_query,
                Some("Soup"),
                &object(json!({"input": {"initial": {"limit": 20}}})),
                &json!({"user": {"id": "user-1", "soup": {"hasMore": false}}}),
                None,
            )
            .await
            .unwrap();

        let aliased = GROUP_QUERY
            .replace("user {", "viewer: user {")
            .replace("groupSoup(input:", "grouped: groupSoup(input:");
        let results = engine
            .inspect_query(&inspection(&aliased, &["viewer", "grouped"]))
            .await
            .unwrap();

        assert_eq!(results.len(), 3);
        assert!(results.windows(2).all(|pair| {
            serde_json::to_string(&pair[0].variables).unwrap()
                < serde_json::to_string(&pair[1].variables).unwrap()
        }));
        let miss = results
            .iter()
            .find(|result| result.variables == initial(50))
            .unwrap();
        assert_eq!(miss.value, None);
        let hit = results
            .iter()
            .find(|result| result.variables == initial(20))
            .unwrap();
        assert_eq!(
            hit.value.as_ref().unwrap()["bins"][0]["items"][0]["id"],
            "task-1"
        );
    });
}

#[test]
fn recovers_nested_constants_lists_and_repeated_variables() {
    block_on(async {
        let query = r#"
query GroupViews($same: String!, $cursor: String!) {
  user {
    id
    groupSoup(input: {
      markers: [$same, "fixed"]
      continuation: {
        groupBy: { field: $same, propertyDefinitionId: $same }
        groupKey: "in-progress"
        cursor: $cursor
      }
    }) { bins { key nextCursor items { __typename id } } }
  }
}
"#;
        let variables = object(json!({"same": "PROPERTY", "cursor": "cursor-1"}));
        let mut engine = Engine::new(InMemoryStorage::new());
        write_group(&mut engine, query, &variables, &page("task-1", None)).await;

        let results = engine
            .inspect_query(&inspection(query, &["user", "groupSoup"]))
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].variables, variables);

        // The same stored arguments do not match a different constant.
        let mismatch = query.replace("groupKey: \"in-progress\"", "groupKey: \"done\"");
        assert!(
            engine
                .inspect_query(&inspection(&mismatch, &["user", "groupSoup"]))
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn traverses_constant_only_prefix_fields() {
    block_on(async {
        let query = GROUP_QUERY.replace("user {", "user(scope: \"all\") {");
        let mut engine = Engine::new(InMemoryStorage::new());
        write_group(&mut engine, &query, &initial(20), &page("task-1", None)).await;

        let results = engine
            .inspect_query(&inspection(&query, &["user", "groupSoup"]))
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].variables, initial(20));
    });
}

#[test]
fn loads_a_cold_normalized_owner() {
    block_on(async {
        let mut writer = Engine::with_capacity(InMemoryStorage::new(), 1);
        write_group(
            &mut writer,
            GROUP_QUERY,
            &initial(20),
            &page("task-1", None),
        )
        .await;

        let mut reopened = Engine::with_capacity(writer.storage().clone(), 1);
        let results = reopened
            .inspect_query(&inspection(GROUP_QUERY, &["user", "groupSoup"]))
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].value.is_some());
    });
}

#[test]
fn inspection_reads_the_effective_optimistic_view() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let variables = initial(20);
        let data = json!({"user": {"id": "user-1", "groupSoup": {"bins": [
            {"key": "in-progress", "nextCursor": null, "items": [{"__typename": "GraphqlSoupDocument", "id": "task-1"}]},
            {"key": "completed", "nextCursor": null, "items": []}
        ]}}});
        write_group(&mut engine, GROUP_QUERY, &variables, &data).await;

        let patch = OptimisticLinkPatch {
            query: GROUP_QUERY.to_string(),
            operation_name: Some("GroupViews".to_string()),
            variables_json: serde_json::to_string(&variables).unwrap(),
            path: vec![
                LinkPathSegment::Field {
                    field: "user".into(),
                },
                LinkPathSegment::Field {
                    field: "groupSoup".into(),
                },
                LinkPathSegment::Field {
                    field: "bins".into(),
                },
                LinkPathSegment::ListItem {
                    list_item: ListItemByScalar {
                        where_field: "key".into(),
                        equals: json!("in-progress"),
                    },
                },
                LinkPathSegment::Field {
                    field: "items".into(),
                },
            ],
            operation: LinkOperation::Remove {
                entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
            },
        };
        let mutation = r#"
mutation SetEntityProperty($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id }
}
"#;
        let mutation_variables = object(json!({"input": {
            "entityType": "DOCUMENT",
            "entityId": "task-1",
            "propertyDefinitionId": "status-def"
        }}));
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: mutation,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_variables,
                    data: &json!({"setEntityProperty": {"id": "property-1"}}),
                    link_patches: &[patch],
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();

        let results = engine
            .inspect_query(&inspection(GROUP_QUERY, &["user", "groupSoup"]))
            .await
            .unwrap();
        assert!(
            results[0].value.as_ref().unwrap()["bins"][0]["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn rejects_invalid_entrypoints_paths_variables_and_limits() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write_group(
            &mut engine,
            GROUP_QUERY,
            &initial(20),
            &page("task-1", None),
        )
        .await;

        let mutation = QueryInspection {
            query: "mutation GroupViews { renameFile(input: {}) { id } }".into(),
            operation_name: Some("GroupViews".into()),
            path: vec!["renameFile".into()],
        };
        assert!(matches!(
            engine.inspect_query(&mutation).await.unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(QueryInspectionError::NotQuery)
        ));
        assert!(matches!(
            engine
                .inspect_query(&inspection(GROUP_QUERY, &[]))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(QueryInspectionError::InvalidDepth(0))
        ));
        assert!(matches!(
            engine
                .inspect_query(&inspection(GROUP_QUERY, &["user", "id"]))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(
                QueryInspectionError::NonCompositeFinalField
            )
        ));
        let too_deep = vec!["user"; 17];
        assert!(matches!(
            engine
                .inspect_query(&inspection(GROUP_QUERY, &too_deep))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(QueryInspectionError::InvalidDepth(
                17
            ))
        ));
        let list_path_query = r#"
query GroupViews {
  user {
    groupSoup(input: { initial: {
      groupBy: { field: PROPERTY, propertyDefinitionId: "status-def" }
      limit: 20
    } }) { bins { items { __typename id } } }
  }
}
"#;
        write_group(
            &mut engine,
            list_path_query,
            &serde_json::Map::new(),
            &page("task-1", None),
        )
        .await;
        assert!(matches!(
            engine
                .inspect_query(&inspection(
                    list_path_query,
                    &["user", "groupSoup", "bins", "items"]
                ))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(QueryInspectionError::WrongShape)
        ));
        assert!(matches!(
            engine
                .inspect_query(&inspection(GROUP_QUERY, &["user", "missing"]))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(
                QueryInspectionError::UnselectedField { .. }
            )
        ));

        let prefix_variable = r#"
query GroupViews($id: String!, $input: GroupedSoupInput!) {
  user(id: $id) { groupSoup(input: $input) { bins { key } } }
}
"#;
        assert!(matches!(
            engine
                .inspect_query(&inspection(prefix_variable, &["user", "groupSoup"]))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(QueryInspectionError::VariablePrefix(
                _
            ))
        ));

        let unresolved = r#"
query GroupViews($input: GroupedSoupInput!, $other: Int!) {
  user { groupSoup(input: $input) { bins(limit: $other) { key } } }
}
"#;
        assert!(matches!(
            engine
                .inspect_query(&inspection(unresolved, &["user", "groupSoup"]))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(
                QueryInspectionError::UnrecoverableVariable(_)
            )
        ));

        let ambiguous = r#"
query GroupViews($input: GroupedSoupInput!) {
  user {
    groupSoup(input: $input) { bins { key } }
    groupSoup(input: $input) { bins { key } }
  }
}
"#;
        assert!(matches!(
            engine
                .inspect_query(&inspection(ambiguous, &["user", "groupSoup"]))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(
                QueryInspectionError::AmbiguousField { .. }
            )
        ));

        for limit in 0..=MAX_INSPECTED_VARIANTS {
            write_group(
                &mut engine,
                GROUP_QUERY,
                &initial(1_000 + limit),
                &page("task-1", None),
            )
            .await;
        }
        assert!(matches!(
            engine
                .inspect_query(&inspection(GROUP_QUERY, &["user", "groupSoup"]))
                .await
                .unwrap_err(),
            cache_core::engine::EngineError::QueryInspection(
                QueryInspectionError::TooManyVariants { .. }
            )
        ));
    });
}
