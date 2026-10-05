//! Tests for Gmail send-as API client.

use models_email::gmail::send_as::SendAsVerificationStatus;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::GmailClient;

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
async fn list_send_as_returns_aliases() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/sendAs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sendAs": [
                {
                    "sendAsEmail": "primary@example.com",
                    "displayName": "Primary User",
                    "isPrimary": true,
                    "isDefault": true,
                    "verificationStatus": "accepted"
                },
                {
                    "sendAsEmail": "alias@example.com",
                    "displayName": "Support Alias",
                    "replyToAddress": "support@example.com",
                    "isPrimary": false,
                    "isDefault": false,
                    "treatAsAlias": true,
                    "verificationStatus": "accepted"
                }
            ]
        })))
        .mount(&server)
        .await;

    let result = list_send_as(&client(&server), "token").await.unwrap();

    assert_eq!(result.len(), 2);

    let primary = &result[0];
    assert_eq!(primary.send_as_email, "primary@example.com");
    assert_eq!(primary.display_name, Some("Primary User".to_string()));
    assert!(primary.is_primary);
    assert!(primary.is_default);
    assert_eq!(
        primary.verification_status,
        SendAsVerificationStatus::Accepted
    );

    let alias = &result[1];
    assert_eq!(alias.send_as_email, "alias@example.com");
    assert_eq!(alias.display_name, Some("Support Alias".to_string()));
    assert_eq!(
        alias.reply_to_address,
        Some("support@example.com".to_string())
    );
    assert!(!alias.is_primary);
    assert!(!alias.is_default);
    assert!(alias.treat_as_alias);
    assert_eq!(
        alias.verification_status,
        SendAsVerificationStatus::Accepted
    );
}

#[tokio::test]
async fn list_send_as_handles_empty_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/sendAs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sendAs": []
        })))
        .mount(&server)
        .await;

    let result = list_send_as(&client(&server), "token").await.unwrap();
    assert!(result.is_empty());
}

#[tokio::test]
async fn get_send_as_returns_alias() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/sendAs/alias@example.com"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sendAsEmail": "alias@example.com",
            "displayName": "My Alias",
            "isPrimary": false,
            "isDefault": false,
            "verificationStatus": "accepted"
        })))
        .mount(&server)
        .await;

    let result = get_send_as(&client(&server), "token", "alias@example.com")
        .await
        .unwrap();

    let alias = result.expect("should return send-as");
    assert_eq!(alias.send_as_email, "alias@example.com");
    assert_eq!(alias.display_name, Some("My Alias".to_string()));
}

#[tokio::test]
async fn get_send_as_returns_none_for_not_found() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/sendAs/unknown@example.com"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let result = get_send_as(&client(&server), "token", "unknown@example.com")
        .await
        .unwrap();

    assert!(result.is_none());
}
