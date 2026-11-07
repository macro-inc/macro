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
async fn each_connections_page_is_one_request_that_returns_the_next_page_token() {
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

    let first = get_connections_page(&client(&server), "token", None, None)
        .await
        .expect("first page should decode");
    assert_eq!(first.connections.len(), 1);
    assert_eq!(first.next_page_token.as_deref(), Some("page-2"));
    assert_eq!(first.next_sync_token, None);

    let last = get_connections_page(&client(&server), "token", None, Some("page-2"))
        .await
        .expect("last page should decode");
    assert_eq!(last.next_page_token, None);
    assert_eq!(last.next_sync_token.as_deref(), Some("sync-final"));
}

#[tokio::test]
async fn other_contacts_pages_send_the_sync_token_with_every_page() {
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

    let first = get_other_contacts_page(&client(&server), "token", Some("old-sync"), None)
        .await
        .expect("first page should decode");
    assert_eq!(first.next_page_token.as_deref(), Some("page-2"));

    let last = get_other_contacts_page(&client(&server), "token", Some("old-sync"), Some("page-2"))
        .await
        .expect("last page should decode");
    assert_eq!(last.other_contacts.len(), 1);
    assert_eq!(last.next_sync_token.as_deref(), Some("new-sync"));
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
