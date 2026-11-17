//! Pins the contract with the authentication service's login endpoints.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, method, path, query_param},
};

use super::AuthServiceEmailCodes;
use crate::domain::{
    models::EmailCodeRequest,
    ports::{EmailCodeError, EmailCodeProvider},
};

const EMAIL: &str = "user+tag@example.com";

/// A server mounted under a path prefix, as the gateway serves the real one.
async fn provider(server: &MockServer) -> AuthServiceEmailCodes {
    AuthServiceEmailCodes::new(
        &format!("{}/auth", server.uri()),
        "https://mcp.macro.com/oauth/callback".to_owned(),
    )
    .expect("provider should build")
}

async fn answer_code_request(status: u16, body: serde_json::Value) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/login/passwordless"))
        .and(body_partial_json(serde_json::json!({
            "email": EMAIL,
            "redirect_uri": "https://mcp.macro.com/oauth/callback",
        })))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .mount(&server)
        .await;
    server
}

async fn answer_redeem(status: u16, body: serde_json::Value) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/auth/oauth/passwordless/123456"))
        .and(query_param("email", EMAIL))
        .and(query_param("disable_redirect", "true"))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .mount(&server)
        .await;
    server
}

#[tokio::test]
async fn requesting_a_code_reports_it_sent() {
    let server = answer_code_request(200, serde_json::json!({})).await;

    let answer = provider(&server).await.request_code(EMAIL).await;

    assert_eq!(answer.expect("code request"), EmailCodeRequest::Sent);
}

#[tokio::test]
async fn requesting_a_code_reports_the_single_sign_on_an_address_needs() {
    let server = answer_code_request(202, serde_json::json!({ "idp_id": "idp-1" })).await;

    let answer = provider(&server).await.request_code(EMAIL).await;

    assert_eq!(
        answer.expect("code request"),
        EmailCodeRequest::SsoRequired {
            idp_id: "idp-1".to_owned()
        }
    );
}

#[tokio::test]
async fn requesting_a_code_maps_each_refusal() {
    for (status, expected) in [
        (400, "invalid email address"),
        (403, "email address may not sign in"),
        (429, "too many attempts"),
        (500, "email sign-in is unavailable"),
    ] {
        let server = answer_code_request(status, serde_json::json!({})).await;

        let error = provider(&server)
            .await
            .request_code(EMAIL)
            .await
            .expect_err("the request should be refused");

        assert_eq!(error.to_string(), expected, "status {status}");
    }
}

#[tokio::test]
async fn redeeming_a_code_returns_tokens_and_their_remaining_lifetime() {
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs()
        + 3600;
    let payload = URL_SAFE_NO_PAD.encode(serde_json::json!({ "exp": exp }).to_string());
    let access_token = format!("header.{payload}.signature");
    let server = answer_redeem(
        200,
        serde_json::json!({ "access_token": access_token, "refresh_token": "refresh" }),
    )
    .await;

    let tokens = provider(&server)
        .await
        .redeem_code(EMAIL, "123456")
        .await
        .expect("code should redeem");

    assert_eq!(tokens.access_token.as_str(), access_token);
    assert_eq!(tokens.refresh_token.as_str(), "refresh");
    assert!(
        (3590..=3600).contains(&tokens.expires_in),
        "expires_in {}",
        tokens.expires_in
    );
}

#[tokio::test]
async fn redeeming_a_wrong_code_is_reported_as_such() {
    let server = answer_redeem(401, serde_json::json!({})).await;

    let error = provider(&server)
        .await
        .redeem_code(EMAIL, "123456")
        .await
        .expect_err("the code should be refused");

    assert!(matches!(error, EmailCodeError::InvalidCode), "{error:?}");
}
