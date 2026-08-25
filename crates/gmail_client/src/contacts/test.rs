use wiremock::matchers::{method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn client(server: &MockServer) -> GmailClient {
    GmailClient::new_with_urls(
        String::new(),
        server.uri(),
        server.uri(),
        server.uri(),
        String::new(),
    )
}

#[tokio::test]
async fn connections_paginate_and_return_the_final_sync_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/people/me/connections"))
        .and(query_param("pageSize", "1000"))
        .and(query_param("requestSyncToken", "true"))
        .and(query_param_is_missing("pageToken"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "connections": [{}],
            "nextPageToken": "page-2"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/people/me/connections"))
        .and(query_param("pageToken", "page-2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "connections": [{}],
            "nextSyncToken": "sync-final"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let (people, sync_token) = list_connections(&client(&server), "token", None)
        .await
        .expect("connections should decode");

    assert_eq!(people.len(), 2);
    assert_eq!(sync_token, "sync-final");
}

#[tokio::test]
async fn other_contacts_incremental_sync_paginates() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/otherContacts"))
        .and(query_param("syncToken", "old-sync"))
        .and(query_param_is_missing("pageSize"))
        .and(query_param_is_missing("pageToken"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "otherContacts": [{}],
            "nextPageToken": "page-2"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/otherContacts"))
        .and(query_param("syncToken", "old-sync"))
        .and(query_param("pageToken", "page-2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "otherContacts": [{}],
            "nextSyncToken": "new-sync"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let (people, sync_token) = list_other_contacts(&client(&server), "token", Some("old-sync"))
        .await
        .expect("other contacts should decode");

    assert_eq!(people.len(), 2);
    assert_eq!(sync_token, "new-sync");
}

#[tokio::test]
async fn missing_connections_sync_token_is_an_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/people/me/connections"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "connections": []
        })))
        .mount(&server)
        .await;

    let error = list_connections(&client(&server), "token", None)
        .await
        .expect_err("missing sync token should fail");

    assert!(matches!(error, GmailApiHttpError::InvalidResponse(_)));
}

#[tokio::test]
async fn missing_other_contacts_sync_token_is_an_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/otherContacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "otherContacts": []
        })))
        .mount(&server)
        .await;

    let error = list_other_contacts(&client(&server), "token", None)
        .await
        .expect_err("missing sync token should fail");

    assert!(matches!(error, GmailApiHttpError::InvalidResponse(_)));
}

#[tokio::test]
async fn self_contact_preserves_the_raw_person_resource() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/people/me"))
        .and(query_param("personFields", "names,emailAddresses,photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "names": [{ "displayName": "Ada" }],
            "emailAddresses": [{ "value": "ada@example.com" }],
            "photos": []
        })))
        .mount(&server)
        .await;

    let person = get_self_connection(&client(&server), "token")
        .await
        .expect("person should decode");
    assert_eq!(person.names[0].display_name.as_deref(), Some("Ada"));
}
