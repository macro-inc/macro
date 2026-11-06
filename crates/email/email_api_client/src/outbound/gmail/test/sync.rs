use wiremock::matchers::{method, path, query_param, query_param_is_missing};
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
async fn reads_and_partitions_one_history_page_at_a_time() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .and(query_param("startHistoryId", "100"))
        .and(query_param_is_missing("pageToken"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/history_page_1.json"),
            "application/json",
        ))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .and(query_param("startHistoryId", "100"))
        .and(query_param("pageToken", "next-page"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/history_page_2.json"),
            "application/json",
        ))
        .expect(1)
        .mount(&server)
        .await;
    let token = AccessToken::new("token");
    let cursor = SyncCursor::gmail("100");

    let first = repository
        .list_changes_page(&token, &cursor, None)
        .await
        .unwrap();
    assert_eq!(first.cursor, Some(SyncCursor::gmail("101")));
    assert_eq!(first.next_page_token.as_deref(), Some("next-page"));
    assert!(first.changes.message_ids_to_upsert.contains("added"));
    assert!(first.changes.message_ids_to_delete.contains("deleted"));

    let last = repository
        .list_changes_page(&token, &cursor, Some("next-page"))
        .await
        .unwrap();
    assert_eq!(last.cursor, Some(SyncCursor::gmail("102")));
    assert_eq!(last.next_page_token, None);
    assert!(last.changes.labels_to_update.contains("labels"));
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
            .list_changes_page(
                &AccessToken::new("token"),
                &SyncCursor::gmail("stale"),
                None
            )
            .await,
        Err(EmailApiError::OutdatedCursor)
    );
}
