//! Generated-query cache inspection integration tests.

use cache_core::engine::{BeginOptimisticWrite, Engine};
use cache_core::link_patch::{
    LinkOperation, LinkPathSegment, ListItemByScalar, OptimisticLinkPatch,
};
use cache_core::predicate::ProjectionMutation;
use cache_core::query_inspection::{MAX_INSPECTED_VARIANTS, QueryInspection, QueryInspectionError};
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, NewQueuedMutation,
    QueuedMutation,
};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{EntityKey, Record};
use pollster::block_on;
use predicate_index::PendingOptimisticProjection;
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
        variable_filters: Vec::new(),
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

#[derive(Clone, Debug)]
struct OwnerOnlyStorage(InMemoryStorage);

impl Storage for OwnerOnlyStorage {
    type Error = std::convert::Infallible;

    async fn get_batch(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, Self::Error> {
        assert!(
            keys.iter()
                .all(|key| key.is_root() || key.0 == "GraphqlUser:user-1"),
            "variables-only inspection loaded a non-owner record: {keys:?}"
        );
        self.0.get_batch(keys).await
    }

    async fn put_batch(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<(), Self::Error> {
        self.0.put_batch(entries).await
    }

    async fn put_batch_with_projections(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), Self::Error> {
        self.0
            .put_batch_with_projections(entries, projections)
            .await
    }

    async fn delete_batch(&mut self, keys: &[EntityKey<'static>]) -> Result<(), Self::Error> {
        self.0.delete_batch(keys).await
    }

    async fn enqueue_mutation_with_shadow(
        &mut self,
        entry: NewQueuedMutation,
        projections: Vec<PendingOptimisticProjection>,
    ) -> Result<MutationId, Self::Error> {
        self.0
            .enqueue_mutation_with_shadow(entry, projections)
            .await
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
        self.0.load_mutation_queue().await
    }

    async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, Self::Error> {
        self.0.claim_next_mutation(request).await
    }

    async fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<bool, Self::Error> {
        self.0
            .defer_mutation(id, claim, next_attempt_at_ms, error)
            .await
    }

    async fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<bool, Self::Error> {
        self.0.complete_mutation(id, claim, entries).await
    }

    async fn complete_mutation_with_projections(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<bool, Self::Error> {
        self.0
            .complete_mutation_with_projections(id, claim, entries, projections)
            .await
    }

    async fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> Result<bool, Self::Error> {
        self.0.discard_mutation(id, claim).await
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.0.clear().await
    }
}

#[test]
fn variants_only_recovers_pages_without_loading_items() {
    block_on(async {
        let mut writer = Engine::new(InMemoryStorage::new());
        let initial_variables = initial(20);
        let continuation_variables = continuation("cursor-1");
        write_group(
            &mut writer,
            GROUP_QUERY,
            &initial_variables,
            &page("task-1", None),
        )
        .await;
        write_group(
            &mut writer,
            GROUP_QUERY,
            &continuation_variables,
            &page("task-2", Some("cursor-2")),
        )
        .await;

        let storage = OwnerOnlyStorage(writer.storage().clone());
        let mut reopened = Engine::new(storage);
        let variants = reopened
            .inspect_query_variants(&inspection(GROUP_QUERY, &["user", "groupSoup"]))
            .await
            .unwrap();

        assert_eq!(variants.len(), 2);
        assert!(
            variants
                .iter()
                .any(|variant| variant.variables == initial_variables)
        );
        assert!(
            variants
                .iter()
                .any(|variant| variant.variables == continuation_variables)
        );
    });
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
            "query Soup($input: SoupInput!) { user { id soup(input: $input) { nextCursor } } }";
        engine
            .write_query(
                None,
                soup_query,
                Some("Soup"),
                &object(json!({"input": {"initial": {"limit": 20}}})),
                &json!({"user": {"id": "user-1", "soup": {"nextCursor": null}}}),
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
fn materializes_only_variants_matching_recursive_variable_filters() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let status_initial = initial(20);
        let status_continuation = continuation("cursor-1");
        let priority_initial = object(json!({"input": {"initial": {
            "groupBy": {"field": "PROPERTY", "propertyDefinitionId": "priority-def"},
            "limit": 20
        }}}));
        write_group(
            &mut engine,
            GROUP_QUERY,
            &status_initial,
            &page("task-1", None),
        )
        .await;
        write_group(
            &mut engine,
            GROUP_QUERY,
            &status_continuation,
            &page("task-2", None),
        )
        .await;
        write_group(
            &mut engine,
            GROUP_QUERY,
            &priority_initial,
            &page("task-3", None),
        )
        .await;

        let mut filtered = inspection(GROUP_QUERY, &["user", "groupSoup"]);
        filtered.variable_filters = vec![
            object(json!({"input": {"initial": {"groupBy": {
                "field": "PROPERTY",
                "propertyDefinitionId": "status-def"
            }}}})),
            object(json!({"input": {"continuation": {"groupBy": {
                "field": "PROPERTY",
                "propertyDefinitionId": "status-def"
            }}}})),
        ];
        let results = engine.inspect_query(&filtered).await.unwrap();

        assert_eq!(results.len(), 2);
        assert!(
            results
                .iter()
                .any(|result| result.variables == status_initial)
        );
        assert!(
            results
                .iter()
                .any(|result| result.variables == status_continuation)
        );
        assert!(
            results
                .iter()
                .all(|result| result.variables != priority_initial)
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
            variable_filters: Vec::new(),
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
