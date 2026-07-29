//! GroupSoup nested-link optimistic transaction integration tests.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::link_patch::{
    LinkOperation, LinkPathSegment, ListItemByScalar, OptimisticLinkPatch,
};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const GROUP_QUERY: &str = r#"
query GroupSoup($input: GroupedSoupInput!) {
  user {
    id
    groupSoup(input: $input) {
      bins {
        key
        totalCount
        nextCursor
        items {
          __typename
          ... on GraphqlSoupDocument {
            id
            properties {
              id
              propertyDefinitionId
              value {
                __typename
                ... on GraphqlSelectOptionPropertyValue { optionIds }
              }
            }
          }
        }
      }
    }
  }
}
"#;

const MUTATION: &str = r#"
mutation SetEntityProperty($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) {
    id
    propertyDefinitionId
    value {
      __typename
      ... on GraphqlSelectOptionPropertyValue { optionIds }
    }
  }
}
"#;

fn object(value: Json) -> serde_json::Map<String, Json> {
    let Json::Object(value) = value else {
        unreachable!()
    };
    value
}

fn query_variables() -> serde_json::Map<String, Json> {
    object(json!({
        "input": {
            "groupBy": { "property": { "propertyDefinitionId": "status-def" } },
            "limit": 20
        }
    }))
}

fn mutation_variables(option: &str) -> serde_json::Map<String, Json> {
    object(json!({
        "input": {
            "entityType": "DOCUMENT",
            "entityId": "task-1",
            "propertyDefinitionId": "status-def",
            "value": { "selectOption": option }
        }
    }))
}

fn property(option: &str) -> Json {
    json!({
        "id": "property-1",
        "propertyDefinitionId": "status-def",
        "value": {
            "__typename": "GraphqlSelectOptionPropertyValue",
            "optionIds": [option]
        }
    })
}

fn group_page() -> Json {
    json!({
        "user": {
            "id": "user-1",
            "groupSoup": {
                "bins": [
                    {
                        "key": "in-progress",
                        "totalCount": 1,
                        "nextCursor": "source-cursor",
                        "items": [{
                            "__typename": "GraphqlSoupDocument",
                            "id": "task-1",
                            "properties": [property("in-progress")]
                        }]
                    },
                    {
                        "key": "completed",
                        "totalCount": 0,
                        "nextCursor": "destination-cursor",
                        "items": []
                    }
                ]
            }
        }
    })
}

fn mutation_response(option: &str) -> Json {
    json!({ "setEntityProperty": property(option) })
}

fn patch(bin: &str, operation: LinkOperation) -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        query: GROUP_QUERY.into(),
        operation_name: Some("GroupSoup".into()),
        variables_json: serde_json::to_string(&query_variables()).unwrap(),
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
                    equals: json!(bin),
                },
            },
            LinkPathSegment::Field {
                field: "items".into(),
            },
        ],
        operation,
    }
}

async fn read_group(engine: &mut Engine<InMemoryStorage>) -> Json {
    match engine
        .read_query(None, GROUP_QUERY, Some("GroupSoup"), &query_variables())
        .await
        .unwrap()
    {
        ReadResult::Hit { data } => data,
        ReadResult::Miss => panic!("expected GroupSoup cache hit"),
    }
}

async fn setup() -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    engine
        .write_query(
            None,
            GROUP_QUERY,
            Some("GroupSoup"),
            &query_variables(),
            &group_page(),
            None,
        )
        .await
        .unwrap();
    engine
}

async fn claim(engine: &mut Engine<InMemoryStorage>, id: u64) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 1,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.queued.id, id);
    MutationClaimToken {
        owner: "runner".into(),
        generation: claimed.lease_generation,
    }
}

#[test]
fn cache_only_read_observes_move_and_rollback_restores_it() {
    block_on(async {
        let mut engine = setup().await;
        let patches = [
            patch(
                "in-progress",
                LinkOperation::Remove {
                    entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
                },
            ),
            patch(
                "completed",
                LinkOperation::PrependUnique {
                    entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
                },
            ),
        ];
        let (transaction, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_variables("completed"),
                    data: &mutation_response("completed"),
                    link_patches: &patches,
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();

        let optimistic = read_group(&mut engine).await;
        let bins = optimistic["user"]["groupSoup"]["bins"].as_array().unwrap();
        assert!(bins[0]["items"].as_array().unwrap().is_empty());
        assert_eq!(bins[1]["items"][0]["id"], json!("task-1"));
        // Server-owned pagination metadata is deliberately untouched.
        assert_eq!(bins[0]["totalCount"], json!(1));
        assert_eq!(bins[1]["totalCount"], json!(0));
        assert_eq!(bins[1]["nextCursor"], json!("destination-cursor"));

        // Durable recipes reconstruct the complete property + relation layer
        // after an application restart.
        let mut reopened = Engine::new(engine.storage().clone());
        let hydrated = read_group(&mut reopened).await;
        assert!(
            hydrated["user"]["groupSoup"]["bins"][0]["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            hydrated["user"]["groupSoup"]["bins"][1]["items"][0]["id"],
            json!("task-1")
        );

        let claim = claim(&mut engine, transaction).await;
        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        let restored = read_group(&mut engine).await;
        assert_eq!(
            restored["user"]["groupSoup"]["bins"][0]["items"][0]["id"],
            json!("task-1")
        );
        assert!(
            restored["user"]["groupSoup"]["bins"][1]["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn success_reapplies_recipe_and_returns_deduplicated_revalidation() {
    block_on(async {
        let mut engine = setup().await;
        let patches = [
            patch(
                "in-progress",
                LinkOperation::Remove {
                    entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
                },
            ),
            patch(
                "completed",
                LinkOperation::PrependUnique {
                    entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
                },
            ),
        ];
        let (transaction, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    query: MUTATION,
                    operation_name: Some("SetEntityProperty"),
                    variables: &mutation_variables("completed"),
                    data: &mutation_response("completed"),
                    link_patches: &patches,
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();

        // A concurrent authoritative write lands while the mutation is
        // pending. Settlement must patch this latest base, not promote the
        // earlier optimistic field snapshot over it.
        let mut concurrent = group_page();
        concurrent["user"]["groupSoup"]["bins"][1]["items"] = json!([{
            "__typename": "GraphqlSoupDocument",
            "id": "task-2",
            "properties": []
        }]);
        engine
            .write_query(
                None,
                GROUP_QUERY,
                Some("GroupSoup"),
                &query_variables(),
                &concurrent,
                None,
            )
            .await
            .unwrap();

        let claim = claim(&mut engine, transaction).await;
        let result = engine
            .commit_optimistic_write(
                transaction,
                claim,
                MUTATION,
                Some("SetEntityProperty"),
                &mutation_variables("completed"),
                &mutation_response("completed"),
            )
            .await
            .unwrap();
        assert_eq!(result.revalidations.len(), 1);
        let committed = read_group(&mut engine).await;
        assert_eq!(
            committed["user"]["groupSoup"]["bins"][1]["items"][0]["id"],
            json!("task-1")
        );
        assert_eq!(
            committed["user"]["groupSoup"]["bins"][1]["items"][1]["id"],
            json!("task-2")
        );
    });
}

#[test]
fn missing_destination_rejects_the_whole_patch_set_without_enqueueing() {
    block_on(async {
        let mut engine = setup().await;
        let patches = [
            patch(
                "in-progress",
                LinkOperation::Remove {
                    entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
                },
            ),
            patch(
                "missing",
                LinkOperation::PrependUnique {
                    entity_key: EntityKey("GraphqlSoupDocument:task-1".into()),
                },
            ),
        ];
        assert!(
            engine
                .begin_optimistic_write(
                    None,
                    BeginOptimisticWrite {
                        query: MUTATION,
                        operation_name: Some("SetEntityProperty"),
                        variables: &mutation_variables("completed"),
                        data: &mutation_response("completed"),
                        link_patches: &patches,
                        revalidations: &[],
                        created_at_ms: 0,
                    },
                )
                .await
                .is_err()
        );
        let original = read_group(&mut engine).await;
        assert_eq!(
            original["user"]["groupSoup"]["bins"][0]["items"][0]["id"],
            json!("task-1")
        );
    });
}
