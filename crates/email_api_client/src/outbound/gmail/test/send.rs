use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use gmail_client::GmailClient;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::message::MessageToSend;
use serde_json::Value;
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::domain::models::{AccessToken, SendRequest};
use crate::domain::ports::MailboxSendClient;
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

#[tokio::test]
async fn builds_posts_and_returns_provider_ids() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/messages/send"))
        .and(header("authorization", "Bearer access-token"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/sent_message.json"),
            "application/json",
        ))
        .mount(&server)
        .await;

    let request = SendRequest {
        message_id: None,
        message: MessageToSend {
            db_id: None,
            provider_id: None,
            replying_to_id: None,
            provider_thread_id: None,
            thread_db_id: None,
            link_id: Uuid::nil(),
            subject: "Adapter subject".to_string(),
            to: Some(vec![ContactInfo {
                email: "recipient@example.com".to_string(),
                name: Some("Recipient".to_string()),
                photo_url: None,
            }]),
            cc: None,
            bcc: None,
            body_text: Some("Adapter body".to_string()),
            body_html: None,
            body_macro: None,
            attachments: None,
            headers_json: None,
            send_time: None,
        },
        from: ContactInfo {
            email: "sender@example.com".to_string(),
            name: Some("Sender".to_string()),
            photo_url: None,
        },
        parent_message_id: Some("parent@example.com".to_string()),
        references: Some(vec!["root@example.com".to_string()]),
    };

    let sent = repository(&server)
        .send_message(
            &AccessToken::new("access-token"),
            &request,
            Some("thread-1"),
        )
        .await
        .unwrap();

    assert_eq!(sent.provider_message_id, "gmail-message-123");
    assert_eq!(sent.provider_thread_id, "gmail-thread-456");

    let requests = server.received_requests().await.unwrap();
    let payload: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(payload["threadId"], "thread-1");
    let mime = URL_SAFE_NO_PAD
        .decode(payload["raw"].as_str().unwrap())
        .unwrap();
    let mime = String::from_utf8(mime).unwrap();
    assert!(mime.contains("Subject: Adapter subject"));
    assert!(mime.contains("Adapter body"));
    assert!(mime.contains("In-Reply-To:"));
    assert!(mime.contains("parent@example.com"));
}

#[tokio::test]
async fn prepared_dispatch_does_not_retry_provider_failure() {
    use crate::domain::ports::MailboxSendRecoveryClient;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/messages/send"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;
    let error = repository(&server)
        .send_prepared(
            &AccessToken::new("access-token"),
            b"Message-ID: <attempt@macro.com>\r\n\r\nbody",
            None,
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        crate::domain::models::EmailApiError::Transient { .. }
    ));
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn prepared_dispatch_preserves_explicit_validation_rejection() {
    use crate::domain::models::EmailApiError;
    use crate::domain::ports::MailboxSendRecoveryClient;
    for status in [400, 413, 422] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/users/me/messages/send"))
            .respond_with(ResponseTemplate::new(status).set_body_string("invalid message"))
            .expect(1)
            .mount(&server)
            .await;
        let error = repository(&server)
            .send_prepared(&AccessToken::new("token"), b"message", None)
            .await
            .unwrap_err();
        assert!(matches!(error, EmailApiError::SendRejected { .. }));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn timeout_and_malformed_success_do_not_establish_rejection() {
    use crate::domain::models::EmailApiError;
    use crate::domain::ports::MailboxSendRecoveryClient;
    for (status, body) in [
        (408, "request timeout"),
        (200, "not JSON"),
        (200, "{}"),
        (302, "redirect"),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/users/me/messages/send"))
            .respond_with(ResponseTemplate::new(status).set_body_raw(body, "application/json"))
            .expect(1)
            .mount(&server)
            .await;
        let error = repository(&server)
            .send_prepared(&AccessToken::new("token"), b"message", None)
            .await
            .unwrap_err();
        assert!(matches!(error, EmailApiError::Permanent { .. }));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn recovery_maps_ids_and_search_errors_without_sending() {
    use crate::domain::ports::MailboxSendRecoveryClient;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "messages": [{"id":"sent-message","threadId":"sent-thread"}]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let found = repository(&server)
        .find_sent_message(&AccessToken::new("token"), "attempt@macro.com")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.provider_message_id, "sent-message");
    assert_eq!(found.provider_thread_id, "sent-thread");
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages"))
        .respond_with(ResponseTemplate::new(429))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        repository(&server)
            .find_sent_message(&AccessToken::new("token"), "attempt@macro.com")
            .await,
        Err(crate::domain::models::EmailApiError::RateLimited { .. })
    ));
}
