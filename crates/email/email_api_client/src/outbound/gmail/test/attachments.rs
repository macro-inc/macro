use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

use super::repository;
use crate::domain::models::{AccessToken, EmailApiError};
use crate::domain::ports::MailboxAttachmentClient;

#[tokio::test]
async fn downloads_and_decodes_base64url_attachments() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path(
            "/users/me/messages/message-1/attachments/attachment-1",
        ))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(include_str!("fixtures/attachment.json"), "application/json"),
        )
        .mount(&server)
        .await;

    assert_eq!(
        repository
            .get_attachment(&AccessToken::new("token"), "message-1", "attachment-1",)
            .await
            .unwrap(),
        b"Hello"
    );
}

#[tokio::test]
async fn invalid_attachment_data_is_permanent() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages/message-1/attachments/invalid"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"size": 1, "data": "!"})),
        )
        .mount(&server)
        .await;

    assert!(matches!(
        repository
            .get_attachment(&AccessToken::new("token"), "message-1", "invalid")
            .await,
        Err(EmailApiError::Permanent { .. })
    ));
}
