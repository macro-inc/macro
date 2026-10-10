use tracing::Level;
use uuid::Uuid;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

use super::repository;
use crate::domain::models::{AccessToken, EmailApiError};
use crate::domain::ports::MailboxContactsClient;
use crate::log_capture::EventLevels;

const EXPIRED_SYNC_TOKEN_BODY: &str = r#"{
  "error": {
    "code": 400,
    "message": "Sync token is expired. Clear local cache and retry call without the sync token.",
    "status": "FAILED_PRECONDITION",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "EXPIRED_SYNC_TOKEN",
        "domain": "people.googleapis.com"
      }
    ]
  }
}"#;

#[tokio::test]
async fn expired_sync_tokens_are_outdated_cursors_logged_below_error() {
    let (server, repository) = repository().await;
    for endpoint in ["/people/me/connections", "/otherContacts"] {
        Mock::given(method("GET"))
            .and(path(endpoint))
            .and(query_param("syncToken", "expired"))
            .respond_with(
                ResponseTemplate::new(400)
                    .set_body_raw(EXPIRED_SYNC_TOKEN_BODY, "application/json"),
            )
            .mount(&server)
            .await;
    }
    let levels = EventLevels::default();
    let _capture = levels.capture();

    let token = AccessToken::new("token");
    let link_id = Uuid::now_v7();
    let contacts = repository
        .list_contacts(&token, link_id, Some("expired"))
        .await;
    let other_contacts = repository
        .list_other_contacts(&token, link_id, Some("expired"))
        .await;

    assert_eq!(contacts.unwrap_err(), EmailApiError::OutdatedCursor);
    assert_eq!(other_contacts.unwrap_err(), EmailApiError::OutdatedCursor);
    assert_eq!(levels.count(Level::ERROR), 0);
    assert_eq!(levels.count(Level::WARN), 4);
}

#[tokio::test]
async fn paginates_contacts_and_returns_the_final_sync_token() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/people/me/connections"))
        .and(query_param("requestSyncToken", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/contacts_page_1.json"),
            "application/json",
        ))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/people/me/connections"))
        .and(query_param("pageToken", "contacts-next"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/contacts_page_2.json"),
            "application/json",
        ))
        .mount(&server)
        .await;

    let contacts = repository
        .list_contacts(&AccessToken::new("token"), Uuid::now_v7(), None)
        .await
        .unwrap();
    assert_eq!(contacts.contacts.len(), 2);
    assert_eq!(contacts.next_sync_token, "contacts-sync-final");
    assert_eq!(
        contacts.contacts[1].original_photo_url.as_deref(),
        Some("https://lh3.googleusercontent.test/second=s128")
    );
}

#[tokio::test]
async fn normalizes_self_and_other_contacts() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/people/me"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(include_str!("fixtures/person.json"), "application/json"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/otherContacts"))
        .and(query_param("syncToken", "previous"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/other_contacts.json"),
            "application/json",
        ))
        .mount(&server)
        .await;

    let link_id = Uuid::now_v7();
    let own = repository
        .get_self_contact(&AccessToken::new("token"), link_id)
        .await
        .unwrap();
    assert_eq!(own.name.as_deref(), Some("Mailbox User"));
    assert_eq!(
        own.original_photo_url.as_deref(),
        Some("https://lh3.googleusercontent.test/photo=s128")
    );

    let other = repository
        .list_other_contacts(&AccessToken::new("token"), link_id, Some("previous"))
        .await
        .unwrap();
    assert_eq!(other.next_sync_token, "other-sync-final");
    assert_eq!(other.contacts[0].link_id, link_id);
}
