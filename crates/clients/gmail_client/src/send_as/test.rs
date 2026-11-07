use models_email::gmail::SendAsVerificationStatus;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
};

use crate::GmailClient;

#[tokio::test]
async fn lists_sender_verification_without_requiring_a_watch_topic() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/sendAs"))
        .and(header("Authorization", "Bearer token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "sendAs": [
                { "sendAsEmail": "base@example.com", "isPrimary": true },
                { "sendAsEmail": "verified@example.com", "verificationStatus": "accepted" },
                { "sendAsEmail": "pending@example.com", "verificationStatus": "pending" },
                { "sendAsEmail": "unknown@example.com", "verificationStatus": "future-status" }
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = GmailClient::new_with_urls(
        None,
        server.uri(),
        server.uri(),
        server.uri(),
        "test".to_owned(),
    );
    let aliases = client.list_send_as("token").await.unwrap().send_as.unwrap();
    assert_eq!(aliases[0].verification_status, None);
    assert_eq!(
        aliases[1].verification_status,
        Some(SendAsVerificationStatus::Accepted)
    );
    assert_eq!(
        aliases[2].verification_status,
        Some(SendAsVerificationStatus::Pending)
    );
    assert_eq!(
        aliases[3].verification_status,
        Some(SendAsVerificationStatus::Unknown)
    );
}
