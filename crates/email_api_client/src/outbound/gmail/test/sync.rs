use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

use super::repository;
use crate::domain::models::{AccessToken, EmailApiError, SyncCursor};
use crate::domain::ports::MailboxSyncClient;

#[tokio::test]
async fn reads_profile_thread_count() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/profile"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(include_str!("fixtures/profile.json"), "application/json"),
        )
        .mount(&server)
        .await;

    assert_eq!(
        repository
            .get_thread_count(&AccessToken::new("token"))
            .await
            .unwrap(),
        42
    );
}

#[tokio::test]
async fn paginates_and_partitions_history() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .and(query_param("startHistoryId", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/history_page_1.json"),
            "application/json",
        ))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .and(query_param("pageToken", "next-page"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/history_page_2.json"),
            "application/json",
        ))
        .mount(&server)
        .await;

    let batch = repository
        .list_changes(&AccessToken::new("token"), &SyncCursor::gmail("100"))
        .await
        .unwrap();

    assert_eq!(batch.next_cursor.as_str(), "102");
    assert!(batch.changes.message_ids_to_upsert.contains("added"));
    assert!(batch.changes.message_ids_to_delete.contains("deleted"));
    assert!(batch.changes.labels_to_update.contains("labels"));
}

#[tokio::test]
async fn only_history_not_found_is_an_outdated_cursor() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .respond_with(ResponseTemplate::new(404).set_body_raw(
            include_str!("fixtures/stale_history_error.json"),
            "application/json",
        ))
        .mount(&server)
        .await;

    assert_eq!(
        repository
            .list_changes(&AccessToken::new("token"), &SyncCursor::gmail("stale"))
            .await,
        Err(EmailApiError::OutdatedCursor)
    );
}
