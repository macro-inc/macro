//! Known-document normalization is separate from Soup membership and survives reload.

use cache_core::engine::{Engine, ReadResult};
use cache_core::search::{SearchProfile, SearchRequest};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value, json};

const DOCUMENT: &str = r#"
query Known($documentIds: [ID!]!) {
  user { id documents(documentIds: $documentIds) {
    __typename id name fileType viewedAt deletedAt properties {
      id propertyDefinitionId value {
        __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
      }
    }
  } }
}"#;
const SOUP: &str = r#"query Browse($input: SoupInput!) {
  user { id soup(input: $input) { items { __typename id displayName } } }
}"#;
const MUTATION: &str = r#"mutation Tags($input: UpdateEntityPropertyOptionsInput!) {
  updateEntityPropertyOptions(input: $input) {
    id propertyDefinitionId value {
      __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
    }
  }
}"#;

fn variables() -> serde_json::Map<String, Value> {
    json!({"documentIds":["link-only"]})
        .as_object()
        .unwrap()
        .clone()
}
fn property(id: &str, option: &str) -> Value {
    json!({"id":id,"propertyDefinitionId":id,"value":{
        "__typename":"GraphqlSelectOptionPropertyValue","optionIds":[option]
    }})
}
fn document(properties: Vec<Value>) -> Value {
    json!({"user":{"id":"viewer","documents":[{
        "__typename":"GraphqlSoupDocument","id":"link-only","name":"CRM plan",
        "fileType":"md","viewedAt":"2026-10-05T16:00:00Z","deletedAt":null,"properties":properties
    }]}})
}
fn search() -> SearchRequest {
    SearchRequest {
        profile: SearchProfile::QuickAccessV1,
        buckets: vec!["note".into()],
        query: "crm".into(),
        cursor: None,
        limit: 10,
        now_ms: 0,
    }
}

#[test]
fn link_document_read_mutation_reconciliation_reload_and_revocation() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                DOCUMENT,
                Some("Known"),
                &variables(),
                &document(vec![property("existing-tag", "crm")]),
                None,
            )
            .await
            .unwrap();
        let browse = json!({"input":{"initial":{"limit":10}}})
            .as_object()
            .unwrap()
            .clone();
        engine
            .write_query(
                None,
                SOUP,
                Some("Browse"),
                &browse,
                &json!({"user":{"id":"viewer","soup":{"items":[]}}}),
                None,
            )
            .await
            .unwrap();
        assert_eq!(engine.search(&search()).await.unwrap().documents.len(), 1);
        let ReadResult::Hit { data, .. } = engine
            .read_query(None, SOUP, Some("Browse"), &browse)
            .await
            .unwrap()
        else {
            panic!("browse must be cached");
        };
        assert!(data["user"]["soup"]["items"].as_array().unwrap().is_empty());

        engine
            .write_query(
                None,
                MUTATION,
                Some("Tags"),
                &json!({"input":{}}).as_object().unwrap().clone(),
                &json!({"updateEntityPropertyOptions":[property("existing-tag", "gql")]}),
                None,
            )
            .await
            .unwrap();
        let ReadResult::Hit { data, .. } = engine
            .read_query(None, DOCUMENT, Some("Known"), &variables())
            .await
            .unwrap()
        else {
            panic!("known document must remain cached");
        };
        assert_eq!(
            data["user"]["documents"][0]["properties"][0]["value"]["optionIds"],
            json!(["gql"])
        );

        // First assignments need the direct parent revalidation, not an empty Soup page.
        engine
            .write_query(
                None,
                DOCUMENT,
                Some("Known"),
                &variables(),
                &document(vec![
                    property("existing-tag", "gql"),
                    property("new-tag", "new"),
                ]),
                None,
            )
            .await
            .unwrap();
        let mut reopened = Engine::new(engine.into_storage());
        let ReadResult::Hit { data, .. } = reopened
            .read_query(None, DOCUMENT, Some("Known"), &variables())
            .await
            .unwrap()
        else {
            panic!("document must survive restart");
        };
        assert_eq!(
            data["user"]["documents"][0]["properties"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(reopened.search(&search()).await.unwrap().documents.len(), 1);
        reopened
            .delete_keys(&[EntityKey("GraphqlSoupDocument:link-only".into())])
            .await
            .unwrap();
        assert!(
            reopened
                .search(&search())
                .await
                .unwrap()
                .documents
                .is_empty()
        );
    });
}

#[test]
fn a_different_viewer_cannot_reuse_a_known_document_projection() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                DOCUMENT,
                Some("Known"),
                &variables(),
                &document(vec![]),
                Some("viewer"),
            )
            .await
            .unwrap();
        assert_eq!(engine.search(&search()).await.unwrap().documents.len(), 1);
        engine
            .write_query(
                None,
                DOCUMENT,
                Some("Known"),
                &variables(),
                &json!({"user":{"id":"another-viewer","documents":[]}}),
                Some("another-viewer"),
            )
            .await
            .unwrap();
        assert!(engine.search(&search()).await.unwrap().documents.is_empty());
    });
}
