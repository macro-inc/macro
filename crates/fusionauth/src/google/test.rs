use wiremock::matchers::{body_string, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::{UnauthedClient, error::FusionAuthClientError};

use super::oauth::revoke_token;

#[tokio::test]
async fn revoke_token_posts_the_token_form_encoded() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/revoke"))
        .and(header("content-type", "application/x-www-form-urlencoded"))
        .and(body_string("token=partial-grant-refresh-token"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    revoke_token(
        &UnauthedClient::new(),
        &format!("{}/revoke", server.uri()),
        "partial-grant-refresh-token",
    )
    .await
    .expect("revocation should succeed");
}

#[tokio::test]
async fn revoke_token_treats_an_invalid_token_as_revoked() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/revoke"))
        .respond_with(ResponseTemplate::new(400).set_body_string(r#"{"error":"invalid_token"}"#))
        .expect(1)
        .mount(&server)
        .await;

    revoke_token(
        &UnauthedClient::new(),
        &format!("{}/revoke", server.uri()),
        "already-revoked",
    )
    .await
    .expect("an invalid token is already revoked");
}

#[tokio::test]
async fn revoke_token_reports_a_server_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/revoke"))
        .respond_with(ResponseTemplate::new(503).set_body_string("unavailable"))
        .expect(1)
        .mount(&server)
        .await;

    let error = revoke_token(
        &UnauthedClient::new(),
        &format!("{}/revoke", server.uri()),
        "token",
    )
    .await
    .expect_err("a server error must surface");

    match error {
        FusionAuthClientError::Generic(response) => {
            assert!(response.message.contains("503"), "{}", response.message);
        }
        other => panic!("expected a generic error, got {other:?}"),
    }
}
