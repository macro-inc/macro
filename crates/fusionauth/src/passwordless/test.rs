use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

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

fn start_body(state: serde_json::Value) -> serde_json::Value {
    json!({
        "loginId": "user@example.com",
        "applicationId": "application-id",
        "state": state,
    })
}

#[tokio::test]
async fn start_carries_the_referral_code_in_the_state() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/passwordless/start"))
        .and(body_json(start_body(json!({
            "client_id": "application-id",
            "response_type": "code",
            "scope": "openid offline_access",
            "redirect_uri": "https://macro.example/app",
            "referral_code": "referrer-code",
        }))))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "code": "login-code" })))
        .expect(1)
        .mount(&server)
        .await;

    let code = client(server.uri())
        .start_passwordless_login(
            "user@example.com",
            "https://macro.example/app",
            Some("referrer-code"),
        )
        .await
        .unwrap();

    assert_eq!(code, "login-code");
}

#[tokio::test]
async fn start_without_a_referral_code_leaves_it_out_of_the_state() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/passwordless/start"))
        .and(body_json(start_body(json!({
            "client_id": "application-id",
            "response_type": "code",
            "scope": "openid offline_access",
            "redirect_uri": "https://macro.example/app",
        }))))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "code": "login-code" })))
        .expect(1)
        .mount(&server)
        .await;

    client(server.uri())
        .start_passwordless_login("user@example.com", "https://macro.example/app", None)
        .await
        .unwrap();
}

#[tokio::test]
async fn complete_returns_the_referral_code_and_user_data() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/passwordless/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "token": "access",
            "refreshToken": "refresh",
            "user": {
                "id": "user-id",
                "email": "user@example.com",
                "data": { "emailCodeSignup": true },
            },
            "state": {
                "redirect_uri": "https://macro.example/app",
                "referral_code": "referrer-code",
            },
        })))
        .expect(1)
        .mount(&server)
        .await;

    let login = client(server.uri())
        .complete_passwordless_login("login-code")
        .await
        .unwrap();

    assert_eq!(login.state.referral_code.as_deref(), Some("referrer-code"));
    assert_eq!(login.user.data, Some(json!({ "emailCodeSignup": true })));
}

#[tokio::test]
async fn complete_accepts_a_state_and_user_without_the_optional_fields() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/passwordless/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "token": "access",
            "refreshToken": "refresh",
            "user": { "id": "user-id", "email": "user@example.com" },
            "state": { "redirect_uri": "https://macro.example/app" },
        })))
        .expect(1)
        .mount(&server)
        .await;

    let login = client(server.uri())
        .complete_passwordless_login("login-code")
        .await
        .unwrap();

    assert_eq!(login.state.referral_code, None);
    assert_eq!(login.user.data, None);
}
