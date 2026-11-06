//! Initiative list, detail, and mutation responses share one normalized entity.

use cache_core::engine::{Engine, NetworkWrite, QueryRegistration, ReadResult};
use cache_core::search::{SearchProfile, SearchRequest};
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Value as Json, json};

const SOUP_QUERY: &str = r#"
query Projects($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupInitiative { displayName }
      }
      nextCursor
    }
  }
}
"#;

const DETAIL_QUERY: &str = r#"
query Project($id: ID!) {
  user {
    id
    initiative(initiativeId: $id) {
      __typename
      id
      displayName
      memberIds
      taskCount
    }
  }
}
"#;

const UPDATE_MUTATION: &str = r#"
mutation UpdateProject($id: ID!, $input: UpdateInitiativeInput!) {
  updateInitiative(initiativeId: $id, input: $input) {
    __typename
    id
    displayName
  }
}
"#;

fn object(value: Json) -> serde_json::Map<String, Json> {
    let Json::Object(value) = value else {
        panic!("expected object")
    };
    value
}

#[test]
fn mutation_updates_list_and_detail_without_losing_detail_fields() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let soup_variables = object(json!({ "input": { "limit": 10 } }));
        let detail_variables = object(json!({ "id": "initiative-1" }));
        let soup_response = json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "items": [{
                        "__typename": "GraphqlSoupInitiative",
                        "id": "initiative-1",
                        "displayName": "Original name"
                    }],
                    "nextCursor": null
                }
            }
        });
        let detail_response = json!({
            "user": {
                "id": "user-1",
                "initiative": {
                    "__typename": "GraphqlSoupInitiative",
                    "id": "initiative-1",
                    "displayName": "Original name",
                    "memberIds": ["user-1", "user-2"],
                    "taskCount": 3
                }
            }
        });

        // Register the two views directly from their network responses.
        // No entity-from-argument resolver or preliminary cache read is needed.
        for (op_id, query, operation_name, variables, data) in [
            (1, SOUP_QUERY, "Projects", &soup_variables, &soup_response),
            (
                2,
                DETAIL_QUERY,
                "Project",
                &detail_variables,
                &detail_response,
            ),
        ] {
            engine
                .write_query_with_registration(
                    Some(op_id),
                    Some(QueryRegistration {
                        op_id,
                        entity_resolvers: &[],
                    }),
                    NetworkWrite {
                        query,
                        operation_name: Some(operation_name),
                        variables,
                        data,
                        identity: None,
                    },
                )
                .await
                .unwrap();
        }

        let write = engine
            .write_query(
                Some(3),
                UPDATE_MUTATION,
                Some("UpdateProject"),
                &object(json!({
                    "id": "initiative-1",
                    "input": { "name": "Renamed project" }
                })),
                &json!({
                    "updateInitiative": {
                        "__typename": "GraphqlSoupInitiative",
                        "id": "initiative-1",
                        "displayName": "Renamed project"
                    }
                }),
                None,
            )
            .await
            .unwrap();

        assert_eq!(write.affected_ops, [1, 2].into());

        let mut expected_soup = soup_response;
        expected_soup["user"]["soup"]["items"][0]["displayName"] = json!("Renamed project");
        let mut expected_detail = detail_response;
        expected_detail["user"]["initiative"]["displayName"] = json!("Renamed project");

        for (op_id, query, operation_name, variables, expected) in [
            (1, SOUP_QUERY, "Projects", &soup_variables, expected_soup),
            (
                2,
                DETAIL_QUERY,
                "Project",
                &detail_variables,
                expected_detail,
            ),
        ] {
            let ReadResult::Hit { data } = engine
                .read_query(Some(op_id), query, Some(operation_name), variables)
                .await
                .unwrap()
            else {
                panic!("expected {operation_name} to remain complete in cache")
            };
            assert_eq!(data, expected);
        }
    });
}

const SEARCHABLE_SOUP_QUERY: &str = r#"
query Projects($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupInitiative {
          displayName
          metadata { updatedAt viewedAt }
        }
      }
      nextCursor
    }
  }
}
"#;

fn initiative_search(query: &str) -> SearchRequest {
    SearchRequest {
        profile: SearchProfile::QuickAccessV1,
        buckets: vec!["initiative".into()],
        query: query.into(),
        cursor: None,
        limit: 20,
        now_ms: 1_000,
    }
}

#[test]
fn soup_initiatives_are_searchable_and_follow_renames() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                SEARCHABLE_SOUP_QUERY,
                Some("Projects"),
                &object(json!({ "input": { "limit": 10 } })),
                &json!({
                    "user": {
                        "id": "user-1",
                        "soup": {
                            "items": [{
                                "__typename": "GraphqlSoupInitiative",
                                "id": "initiative-1",
                                "displayName": "Launch plan",
                                "metadata": {
                                    "updatedAt": "2025-01-03T00:00:00Z",
                                    "viewedAt": "2025-01-01T00:00:00Z"
                                }
                            }],
                            "nextCursor": null
                        }
                    }
                }),
                None,
            )
            .await
            .unwrap();

        let found = engine.search(&initiative_search("launch")).await.unwrap();
        assert_eq!(found.documents.len(), 1);
        let document = &found.documents[0];
        assert_eq!(
            document.record_key.as_ref(),
            "GraphqlSoupInitiative:initiative-1"
        );
        assert_eq!(document.bucket, "initiative");
        assert_eq!(document.timestamp_ms, 1_735_689_600_000);

        engine
            .write_query(
                None,
                UPDATE_MUTATION,
                Some("UpdateProject"),
                &object(json!({
                    "id": "initiative-1",
                    "input": { "name": "Roadmap" }
                })),
                &json!({
                    "updateInitiative": {
                        "__typename": "GraphqlSoupInitiative",
                        "id": "initiative-1",
                        "displayName": "Roadmap"
                    }
                }),
                None,
            )
            .await
            .unwrap();

        assert!(
            engine
                .search(&initiative_search("launch"))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
        assert_eq!(
            engine
                .search(&initiative_search("roadmap"))
                .await
                .unwrap()
                .documents
                .len(),
            1
        );
    });
}
