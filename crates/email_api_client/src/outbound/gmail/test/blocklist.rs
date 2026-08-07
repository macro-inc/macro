use gmail_client::GmailClient;
use serde_json::{Value, json};
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::domain::models::AccessToken;
use crate::domain::ports::MailboxBlocklistClient;
use crate::outbound::gmail::GmailApiClientRepository;

fn repository(server: &MockServer) -> GmailApiClientRepository {
    GmailApiClientRepository::new(GmailClient::new_with_urls(
        "projects/p/topics/mail".to_string(),
        server.uri(),
        server.uri(),
        server.uri(),
        "audience".to_string(),
    ))
}

async fn mount_filters(server: &MockServer, filters: Value) {
    Mock::given(method("GET"))
        .and(path("/users/me/settings/filters"))
        .respond_with(ResponseTemplate::new(200).set_body_json(filters))
        .mount(server)
        .await;
}

#[tokio::test]
async fn list_returns_only_sender_filters_that_add_trash() {
    let server = MockServer::start().await;
    mount_filters(
        &server,
        serde_json::from_str(include_str!("fixtures/filters.json")).unwrap(),
    )
    .await;

    let blocked = repository(&server)
        .list_blocked_senders(&AccessToken::new("token"))
        .await
        .unwrap();

    assert_eq!(blocked, vec!["blocked@example.com"]);
}

#[tokio::test]
async fn blocking_an_existing_sender_is_idempotent() {
    let server = MockServer::start().await;
    mount_filters(
        &server,
        serde_json::from_str(include_str!("fixtures/filters.json")).unwrap(),
    )
    .await;

    repository(&server)
        .block_sender(&AccessToken::new("token"), "blocked@example.com")
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method.as_str(), "GET");
}

#[tokio::test]
async fn block_creates_a_sender_to_trash_filter() {
    let server = MockServer::start().await;
    mount_filters(&server, json!({ "filter": [] })).await;
    let expected = json!({
        "criteria": { "from": "new@example.com" },
        "action": { "addLabelIds": ["TRASH"] }
    });
    Mock::given(method("POST"))
        .and(path("/users/me/settings/filters"))
        .and(body_json(expected.clone()))
        .respond_with(ResponseTemplate::new(200).set_body_json(expected))
        .expect(1)
        .mount(&server)
        .await;

    repository(&server)
        .block_sender(&AccessToken::new("token"), "new@example.com")
        .await
        .unwrap();
}

#[tokio::test]
async fn blocking_is_idempotent_across_address_casing() {
    let server = MockServer::start().await;
    mount_filters(
        &server,
        json!({
            "filter": [{
                "id": "blocked-cased",
                "criteria": { "from": "John@Example.com" },
                "action": { "addLabelIds": ["TRASH"] }
            }]
        }),
    )
    .await;

    repository(&server)
        .block_sender(&AccessToken::new("token"), "john@example.com")
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1, "no duplicate filter may be created");
    assert_eq!(requests[0].method.as_str(), "GET");
}

#[tokio::test]
async fn unblock_matches_filters_case_insensitively_and_deletes_all_duplicates() {
    let server = MockServer::start().await;
    mount_filters(
        &server,
        json!({
            "filter": [
                {
                    "id": "blocked-upper",
                    "criteria": { "from": "John@Example.com" },
                    "action": { "addLabelIds": ["TRASH"] }
                },
                {
                    "id": "other",
                    "criteria": { "from": "someone-else@example.com" },
                    "action": { "addLabelIds": ["TRASH"] }
                },
                {
                    "id": "blocked-lower",
                    "criteria": { "from": "john@example.com" },
                    "action": { "addLabelIds": ["TRASH"] }
                }
            ]
        }),
    )
    .await;
    Mock::given(method("DELETE"))
        .and(path("/users/me/settings/filters/blocked-upper"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/users/me/settings/filters/blocked-lower"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    repository(&server)
        .unblock_sender(&AccessToken::new("token"), "JOHN@example.com")
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 3, "one list plus exactly two deletes");
}

#[tokio::test]
async fn unblocking_a_missing_sender_is_idempotent() {
    let server = MockServer::start().await;
    mount_filters(&server, json!({ "filter": [] })).await;

    repository(&server)
        .unblock_sender(&AccessToken::new("token"), "missing@example.com")
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method.as_str(), "GET");
}

#[tokio::test]
async fn unblock_deletes_the_matching_block_filter() {
    let server = MockServer::start().await;
    mount_filters(
        &server,
        serde_json::from_str(include_str!("fixtures/filters.json")).unwrap(),
    )
    .await;
    Mock::given(method("DELETE"))
        .and(path("/users/me/settings/filters/blocked-1"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    repository(&server)
        .unblock_sender(&AccessToken::new("token"), "blocked@example.com")
        .await
        .unwrap();
}
