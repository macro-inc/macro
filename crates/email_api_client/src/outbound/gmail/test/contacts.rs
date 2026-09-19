use uuid::Uuid;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

use super::repository;
use crate::domain::models::AccessToken;
use crate::domain::ports::MailboxContactsClient;

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
