use wiremock::matchers::{body_string, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::FusionAuthClient;

fn client(base_url: String) -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        base_url,
        "http://localhost:28011/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
}

#[tokio::test]
async fn revoke_refresh_token_sends_the_token_form_encoded() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/api/jwt/refresh"))
        .and(header("authorization", "api-key"))
        .and(header("content-type", "application/x-www-form-urlencoded"))
        .and(body_string("token=refresh-token"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    client(server.uri())
        .revoke_refresh_token("refresh-token")
        .await
        .expect("revocation should succeed");
}

#[tokio::test]
async fn revoke_refresh_token_treats_an_unknown_token_as_revoked() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/api/jwt/refresh"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;

    client(server.uri())
        .revoke_refresh_token("already-revoked")
        .await
        .expect("an unknown token is already revoked");
}

#[tokio::test]
async fn revoke_refresh_token_reports_a_server_error() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/api/jwt/refresh"))
        .respond_with(ResponseTemplate::new(503).set_body_string("unavailable"))
        .expect(1)
        .mount(&server)
        .await;

    client(server.uri())
        .revoke_refresh_token("refresh-token")
        .await
        .expect_err("a server error must not count as a revocation");
}
