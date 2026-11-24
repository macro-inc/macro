use crate::EmailServiceClient;
use crate::get_recent_inbox_messages::{InboxWindow, RecentMailFolder};
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

#[tokio::test]
async fn asks_for_one_users_messages_with_internal_auth() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/internal/recent_messages/macro|owner@example.com"))
        .and(query_param("limit", "20"))
        .and(header("x-internal-auth-key", "internal-key"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"messages": [{
                "inbox": "owner@example.com",
                "from": {"email": "billing@example.com", "name": "Billing"},
                "to": ["owner@example.com"],
                "cc": [],
                "subject": "Invoice 42",
                "snippet": "Your invoice is attached",
                "received_at": "2026-10-27T09:00:00Z"
            }]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    let response = client
        .get_recent_inbox_messages("macro|owner@example.com", 20)
        .await
        .unwrap();

    assert_eq!(response.messages.len(), 1);
    assert_eq!(response.messages[0].subject.as_deref(), Some("Invoice 42"));
}

#[tokio::test]
async fn an_error_status_fails_the_call() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    let error = client
        .get_recent_inbox_messages("macro|owner@example.com", 20)
        .await
        .unwrap_err();

    // The error names no user: callers record it on their spans.
    assert!(!format!("{error:#}").contains("owner"), "{error:#}");
}

#[tokio::test]
async fn asks_for_longer_snippets_and_reads_labels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/internal/recent_messages/macro|owner@example.com"))
        .and(query_param("limit", "100"))
        .and(query_param("snippet_chars", "500"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"messages": [{
                "inbox": "owner@example.com",
                "from": null,
                "to": [],
                "cc": [],
                "subject": "Invoice 42",
                "snippet": "Your invoice is attached",
                "received_at": null,
                "labels": ["INBOX", "Billing"]
            }]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    let response = client
        .get_recent_inbox_messages_with_snippets("macro|owner@example.com", 100, Some(500))
        .await
        .unwrap();

    assert_eq!(response.messages[0].labels, ["INBOX", "Billing"]);
}

#[tokio::test]
async fn an_inbox_window_preserves_the_exact_query_string() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/internal/recent_messages/macro|owner@example.com"))
        .and(query_param("days", "30"))
        .and(query_param("limit", "500"))
        .and(query_param("texts", "100"))
        .and(query_param("snippet_chars", "300"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"messages": [{
                "inbox": "owner@example.com",
                "from": null,
                "to": [],
                "cc": [],
                "subject": "Invoice 42",
                "snippet": null,
                "received_at": "2026-11-02T09:00:00Z",
                "labels": ["INBOX"]
            }]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    let response = client
        .get_inbox_window(
            "macro|owner@example.com",
            InboxWindow {
                folder: RecentMailFolder::Inbox,
                days: 30,
                limit: 500,
                texts: 100,
                snippet_chars: 300,
            },
        )
        .await
        .unwrap();

    assert_eq!(response.messages[0].subject.as_deref(), Some("Invoice 42"));
    assert_eq!(response.messages[0].snippet, None);
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests[0].url.query(),
        Some("days=30&limit=500&texts=100&snippet_chars=300")
    );
}

#[tokio::test]
async fn a_sent_window_adds_its_folder_to_the_query() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/internal/recent_messages/macro|owner@example.com"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"messages": []})))
        .expect(1)
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    client
        .get_inbox_window(
            "macro|owner@example.com",
            InboxWindow {
                folder: RecentMailFolder::Sent,
                days: 30,
                limit: 500,
                texts: 100,
                snippet_chars: 500,
            },
        )
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests[0].url.query(),
        Some("days=30&limit=500&texts=100&snippet_chars=500&folder=sent")
    );
}

#[tokio::test]
async fn partial_context_keeps_typed_unsupported_mailboxes() {
    use models_email::email::service::message::UnreadableMailboxReason;
    let server = MockServer::start().await;
    let link_id = "00000000-0000-0000-0000-000000000001";
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "messages": [],
            "unreadable_mailboxes": [{"link_id": link_id, "reason": "unsupported"}]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());
    let response = client
        .get_inbox_window(
            "macro|owner@example.com",
            InboxWindow {
                folder: RecentMailFolder::Sent,
                days: 30,
                limit: 100,
                texts: 100,
                snippet_chars: 300,
            },
        )
        .await
        .unwrap();
    assert!(response.messages.is_empty());
    assert_eq!(response.unreadable_mailboxes.len(), 1);
    assert_eq!(
        response.unreadable_mailboxes[0].link_id.to_string(),
        link_id
    );
    assert_eq!(
        response.unreadable_mailboxes[0].reason,
        UnreadableMailboxReason::Unsupported
    );
}
