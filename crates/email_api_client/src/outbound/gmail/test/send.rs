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
