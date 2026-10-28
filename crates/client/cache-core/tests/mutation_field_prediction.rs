//! Web resolvers predict a mutation field once, shaped by a representative
//! document. Another document selecting that field normalizes the same
//! prediction through its own selection.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Map, Value, json};

const QUERY: &str = r#"query Items($input: SoupInput!) {
  user { id soup(input: $input) { items {
    __typename id displayName
    ... on GraphqlSoupDocument { documentName: name ownerId }
  } nextCursor } }
}"#;

/// The rename resolver's value, shaped by `RenameEntities` and its
/// `SoupItemFields` selection, including the `documentName: name` alias.
fn prediction() -> Value {
    json!({"results": [{
        "__typename": "GraphqlMutationSuccess",
        "effects": [{
            "__typename": "SoupUpdated",
            "item": {
                "__typename": "GraphqlSoupDocument",
                "id": "doc",
                "displayName": "Renamed",
                "documentName": "Renamed",
            },
        }],
    }]})
}

fn object(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

/// Seeds one document, then installs the prediction through `mutation`,
/// placed under `response_key` as the web exchange does.
async fn predicted_item(mutation: &str, operation: &str, response_key: &str) -> Value {
    let mut engine = Engine::new(InMemoryStorage::new());
    let list = object(json!({"input": {"initial": {"limit": 100}}}));
    engine
        .write_query(
            None,
            QUERY,
            Some("Items"),
            &list,
            &json!({"user": {"id": "viewer", "soup": {"items": [{
                "__typename": "GraphqlSoupDocument", "id": "doc", "displayName": "Draft",
                "documentName": "Draft", "ownerId": "owner",
            }], "nextCursor": null}}}),
            None,
        )
        .await
        .unwrap();
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                identity_bindings: &[],
                uuid: "11111111-1111-4111-8111-111111111111",
                query: mutation,
                operation_name: Some(operation),
                variables: &object(json!({"id": "doc", "name": "Renamed"})),
                data: &json!({ response_key: prediction() }),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
            },
        )
        .await
        .unwrap();
    let ReadResult::Hit { data } = engine
        .read_query(None, QUERY, Some("Items"), &list)
        .await
        .unwrap()
    else {
        panic!("the seeded list must stay readable");
    };
    data["user"]["soup"]["items"][0].clone()
}

#[test]
fn a_narrower_document_applies_only_the_fields_it_selects() {
    let item = block_on(predicted_item(
        r#"mutation RenameTitle($id: ID!, $name: String!) {
          renamed: renameEntities(
            inputs: [{ entity: { type: DOCUMENT, id: $id }, displayName: $name }]
          ) { results { __typename ... on GraphqlMutationSuccess { effects {
            __typename ... on SoupUpdated { item { __typename id displayName } }
          } } } }
        }"#,
        "RenameTitle",
        "renamed",
    ));
    assert_eq!(item["displayName"], "Renamed");
    assert_eq!(
        item["documentName"], "Draft",
        "an unselected predicted field must be ignored"
    );
    assert_eq!(item["ownerId"], "owner");
}

#[test]
fn a_wider_document_patches_the_existing_entity() {
    let item = block_on(predicted_item(
        r#"mutation RenameWithOwner($id: ID!, $name: String!) {
          renameEntities(
            inputs: [{ entity: { type: DOCUMENT, id: $id }, displayName: $name }]
          ) { results { __typename ... on GraphqlMutationSuccess { effects {
            __typename ... on SoupUpdated { item {
              __typename id displayName
              ... on GraphqlSoupDocument { documentName: name ownerId updatedAt }
            } }
          } } } }
        }"#,
        "RenameWithOwner",
        "renameEntities",
    ));
    assert_eq!(item["displayName"], "Renamed");
    assert_eq!(item["documentName"], "Renamed");
    assert_eq!(
        item["ownerId"], "owner",
        "a selected field missing from the prediction must keep its cached value"
    );
}

#[test]
fn nested_response_keys_must_match_the_representative_aliases() {
    let item = block_on(predicted_item(
        r#"mutation RenameName($id: ID!, $name: String!) {
          renameEntities(
            inputs: [{ entity: { type: DOCUMENT, id: $id }, displayName: $name }]
          ) { results { __typename ... on GraphqlMutationSuccess { effects {
            __typename ... on SoupUpdated { item {
              __typename id displayName ... on GraphqlSoupDocument { name }
            } }
          } } } }
        }"#,
        "RenameName",
        "renameEntities",
    ));
    assert_eq!(item["displayName"], "Renamed");
    assert_eq!(
        item["documentName"], "Draft",
        "the prediction names `name` only through the `documentName` alias"
    );
}
