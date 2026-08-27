use uuid::Uuid;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

use super::repository;
use crate::domain::models::{AccessToken, EmailApiError};
use crate::domain::ports::{MailboxCalendarClient, MailboxMessageClient};

#[tokio::test]
async fn normalizes_messages_and_preserves_deletion_races() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages/message-1"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/message_full.json"),
            "application/json",
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages/deleted"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let link_id = Uuid::now_v7();
    let fetched = repository
        .get_message(&AccessToken::new("token"), link_id, "message-1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fetched.message.link_id, link_id);
    assert_eq!(fetched.message.subject.as_deref(), Some("Fixture message"));
    assert!(!fetched.message.is_read);
    assert!(fetched.calendar_parts.is_empty());
    assert!(
        repository
            .get_message(&AccessToken::new("token"), link_id, "deleted")
            .await
            .unwrap()
            .is_none()
    );
}

fn calendar_message_body() -> serde_json::Value {
    serde_json::json!({
            "id": "calendar",
            "threadId": "thread",
            "historyId": "1",
            "internalDate": "1",
            "labelIds": [],
            "snippet": "",
            "sizeEstimate": 0,
            "payload": {
                "partId": "",
                "mimeType": "multipart/mixed",
                "filename": "",
                "headers": [],
                "parts": [
                    {
                        "partId": "inline",
                        "mimeType": "text/calendar; method=REQUEST",
                        "filename": "",
                        "headers": [],
                        "body": {"size": 5, "data": "aGVsbG8"}
                    },
                    {
                        "partId": "attachment",
                        "mimeType": "application/octet-stream",
                        "filename": "invite.ics",
                        "headers": [],
                        "body": {"size": 10, "attachmentId": "attachment-id"}
                    }
                ]
            }
    })
}

fn assert_calendar_parts(parts: &[crate::domain::models::CalendarPart]) {
    assert_eq!(parts.len(), 2);
    assert!(
        parts
            .iter()
            .any(|part| part.inline_data.as_deref() == Some(b"hello".as_slice()))
    );
    assert!(
        parts
            .iter()
            .any(|part| part.provider_attachment_id.as_deref() == Some("attachment-id"))
    );
}

#[tokio::test]
async fn discovers_inline_and_attachment_calendar_parts() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages/calendar"))
        .respond_with(ResponseTemplate::new(200).set_body_json(calendar_message_body()))
        .mount(&server)
        .await;

    let parts = repository
        .get_calendar_parts(&AccessToken::new("token"), "calendar")
        .await
        .unwrap();
    assert_calendar_parts(&parts);
}

#[tokio::test]
async fn get_message_surfaces_calendar_parts_from_a_single_wire_fetch() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages/calendar"))
        .respond_with(ResponseTemplate::new(200).set_body_json(calendar_message_body()))
        .expect(1)
        .mount(&server)
        .await;

    let fetched = repository
        .get_message(&AccessToken::new("token"), Uuid::now_v7(), "calendar")
        .await
        .unwrap()
        .unwrap();

    assert_calendar_parts(&fetched.calendar_parts);
    // Dropping the server verifies the .expect(1) call count: the calendar
    // parts came from the same messages.get as the normalized message.
}

#[tokio::test]
async fn normalizes_full_threads() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/threads/thread-1"))
        .and(query_param("format", "full"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/thread_full.json"),
            "application/json",
        ))
        .mount(&server)
        .await;

    let messages = repository
        .get_thread(&AccessToken::new("token"), Uuid::now_v7(), "thread-1")
        .await
        .unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].provider_thread_id.as_deref(), Some("thread-1"));
}

#[tokio::test]
async fn lists_threads_and_messages_with_provider_pagination() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/threads"))
        .and(query_param("pageToken", "next"))
        .and(query_param("labelIds", "INBOX"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "threads": [{"id": "thread-1"}],
            "nextPageToken": "after"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages"))
        .and(query_param("labelIds", "SENT"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "messages": [{"id": "message-1"}]
        })))
        .mount(&server)
        .await;

    let threads = repository
        .list_threads(&AccessToken::new("token"), 10, Some("next"), &["INBOX"])
        .await
        .unwrap();
    assert_eq!(threads.threads[0].provider_id, "thread-1");
    assert_eq!(threads.next_page_token.as_deref(), Some("after"));
    assert_eq!(
        repository
            .list_messages(&AccessToken::new("token"), 10, &["SENT"])
            .await
            .unwrap(),
        ["message-1"]
    );
}

#[tokio::test]
async fn modifies_labels_and_maps_conversion_errors_as_permanent() {
    let (server, repository) = repository().await;
    Mock::given(method("POST"))
        .and(path("/users/me/messages/message-1/modify"))
        .and(body_json(serde_json::json!({
            "addLabelIds": ["STARRED"],
            "removeLabelIds": ["UNREAD"]
        })))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    repository
        .modify_message_labels(
            &AccessToken::new("token"),
            "message-1",
            &["STARRED".to_string()],
            &["UNREAD".to_string()],
        )
        .await
        .unwrap();

    Mock::given(method("GET"))
        .and(path("/users/me/messages/malformed"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&server)
        .await;
    assert!(matches!(
        repository
            .get_message(&AccessToken::new("token"), Uuid::now_v7(), "malformed")
            .await,
        Err(EmailApiError::Permanent { .. })
    ));
}
