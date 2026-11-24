use super::*;
use wiremock::matchers::{body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// `client:secret`, as HTTP Basic sends it.
const BASIC: &str = "Basic Y2xpZW50OnNlY3JldA==";

pub(crate) fn client_at(server: &MockServer) -> OAuthClient {
    OAuthClient::new(
        ApiApp::autodesk_at(Url::parse(&server.uri()).unwrap()).unwrap(),
        "client".to_owned(),
        Zeroizing::new("secret".to_owned()),
        Url::parse("https://cognition.example.com/connectors/apps/auth/callback").unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn the_authorize_url_asks_for_a_code_with_pkce() {
    let server = MockServer::start().await;
    let url = client_at(&server).authorize_url("state-1", "challenge-1");

    assert_eq!(url.path(), "/authentication/v2/authorize");
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["response_type"], "code");
    assert_eq!(query["client_id"], "client");
    assert_eq!(
        query["redirect_uri"],
        "https://cognition.example.com/connectors/apps/auth/callback"
    );
    assert_eq!(query["scope"], "data:read");
    assert_eq!(query["state"], "state-1");
    assert_eq!(query["code_challenge"], "challenge-1");
    assert_eq!(query["code_challenge_method"], "S256");
}

#[tokio::test]
async fn the_code_is_exchanged_with_its_verifier() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/authentication/v2/token"))
        .and(header("authorization", BASIC))
        .and(body_string_contains("grant_type=authorization_code"))
        .and(body_string_contains("code=code-1"))
        .and(body_string_contains("code_verifier=verifier-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "access-1",
            "refresh_token": "refresh-1",
            "token_type": "Bearer",
            "expires_in": 3599,
        })))
        .expect(1)
        .mount(&server)
        .await;

    let tokens = client_at(&server)
        .exchange("code-1", "verifier-1")
        .await
        .unwrap();

    assert_eq!(tokens.access_token.as_str(), "access-1");
    assert_eq!(tokens.refresh_token.unwrap().as_str(), "refresh-1");
    assert_eq!(tokens.expires_in, 3599);
}

#[tokio::test]
async fn a_refresh_answers_with_the_rotated_refresh_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/authentication/v2/token"))
        .and(body_string_contains("grant_type=refresh_token"))
        .and(body_string_contains("refresh_token=refresh-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 3599,
        })))
        .mount(&server)
        .await;

    let tokens = client_at(&server).refresh("refresh-1").await.unwrap();

    assert_eq!(tokens.access_token.as_str(), "access-2");
    assert_eq!(tokens.refresh_token.unwrap().as_str(), "refresh-2");
}

#[tokio::test]
async fn invalid_grant_is_told_apart_from_other_refusals() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_string_contains("refresh_token=dead"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": "invalid_grant",
            "error_description": "The refresh token is invalid or expired.",
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(body_string_contains("refresh_token=busy"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let client = client_at(&server);

    assert!(matches!(
        client.refresh("dead").await,
        Err(TokenError::InvalidGrant)
    ));
    assert!(matches!(
        client.refresh("busy").await,
        Err(TokenError::Refused(status)) if status == http::StatusCode::SERVICE_UNAVAILABLE
    ));
}

#[tokio::test]
async fn revoking_sends_the_refresh_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/authentication/v2/revoke"))
        .and(header("authorization", BASIC))
        .and(body_string_contains("token=refresh-1"))
        .and(body_string_contains("token_type_hint=refresh_token"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    client_at(&server).revoke("refresh-1").await.unwrap();
}
