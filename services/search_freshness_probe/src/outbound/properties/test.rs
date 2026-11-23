use chrono::Utc;
use models_properties::PropertyOwner;
use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn definition(id: Uuid, display_name: &str, data_type: DataType) -> PropertyDefinition {
    PropertyDefinition {
        id,
        owner: PropertyOwner::User {
            user_id: "macro|probe@example.com".to_owned(),
        },
        display_name: display_name.to_owned(),
        data_type,
        is_multi_select: false,
        specific_entity_type: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        is_system: false,
        is_metadata: false,
    }
}

async fn listing(definitions: Vec<PropertyDefinition>) -> (MockServer, Properties) {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/dss/properties/definitions"))
        .and(query_param("scope", "user"))
        .respond_with(ResponseTemplate::new(200).set_body_json(definitions))
        .mount(&server)
        .await;
    let api = MacroApi::new(&server.uri(), "mak_key").expect("a valid key");
    (server, Properties::new(api))
}

#[tokio::test]
async fn the_probes_text_property_is_reused_when_it_exists() {
    let existing = Uuid::new_v4();
    let (server, mut properties) = listing(vec![
        definition(Uuid::new_v4(), MARKER, DataType::Number),
        definition(Uuid::new_v4(), "Status", DataType::String),
        definition(existing, MARKER, DataType::String),
    ])
    .await;
    Mock::given(method("POST"))
        .and(path("/dss/properties/definitions"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    let found = properties.definition().await.expect("found");

    assert_eq!(found, EntityId(existing));
}

#[tokio::test]
async fn the_probes_text_property_is_created_when_missing() {
    let created = Uuid::new_v4();
    let (server, mut properties) = listing(vec![]).await;
    Mock::given(method("POST"))
        .and(path("/dss/properties/definitions"))
        .and(body_json(json!({
            "scope": "user",
            "display_name": MARKER,
            "data_type": {"type": "string"},
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(definition(
            created,
            MARKER,
            DataType::String,
        )))
        .expect(1)
        .mount(&server)
        .await;

    let found = properties.definition().await.expect("created");

    assert_eq!(found, EntityId(created));
}

#[tokio::test]
async fn a_value_is_set_as_a_string_on_the_document() {
    let (server, mut properties) = listing(vec![]).await;
    let document = Uuid::new_v4();
    let definition = Uuid::new_v4();
    let value = Token::random();
    Mock::given(method("PUT"))
        .and(path(format!(
            "/dss/properties/entities/DOCUMENT/{document}/{definition}"
        )))
        .and(body_json(
            json!({"value": {"type": "string", "value": value.as_str()}}),
        ))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    properties
        .set(EntityId(document), EntityId(definition), &value)
        .await
        .expect("set");
}
