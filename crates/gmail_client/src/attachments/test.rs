use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn client(server: &MockServer) -> GmailClient {
    GmailClient::new_with_urls(
        String::new(),
        server.uri(),
        server.uri(),
        server.uri(),
        String::new(),
    )
}

#[tokio::test]
async fn attachment_decodes_unpadded_base64url_data() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/users/me/messages/message-1/attachments/attachment-1",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 2,
            "data": "-_8"
        })))
        .mount(&server)
        .await;

    let data = get_attachment_data(&client(&server), "token", "message-1", "attachment-1")
        .await
        .expect("attachment should decode");

    assert_eq!(data, [251, 255]);
}

#[tokio::test]
async fn attachment_without_data_is_an_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/users/me/messages/message-1/attachments/attachment-1",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 0
        })))
        .mount(&server)
        .await;

    let error = get_attachment_data(&client(&server), "token", "message-1", "attachment-1")
        .await
        .expect_err("missing data should fail");

    assert!(matches!(error, GmailApiHttpError::InvalidResponse(_)));
}
