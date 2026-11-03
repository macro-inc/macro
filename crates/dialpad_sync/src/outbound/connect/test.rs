use super::*;
use macro_user_id::cowlike::CowLike;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path},
};

const TOKEN_PATH: &str = "/v1/users/macro|ada@example.com/connections/dialpad/token";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|ada@example.com")
        .unwrap()
        .into_owned()
}

fn grants(server: &MockServer) -> ConnectGrants {
    ConnectGrants::new(&server.uri(), "customer-key").unwrap()
}

async fn token_reply(reply: ResponseTemplate) -> Result<Grant> {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(TOKEN_PATH))
        .and(header("authorization", "Bearer customer-key"))
        .respond_with(reply)
        .expect(1)
        .mount(&server)
        .await;
    grants(&server).grant(&user()).await
}

#[tokio::test]
async fn token_exports_map_to_grants() {
    let active = token_reply(
        ResponseTemplate::new(200).set_body_json(json!({"accessToken": "t0k", "expiresAt": null})),
    )
    .await
    .unwrap();
    assert!(matches!(active, Grant::Active(AccessToken(token)) if token.as_str() == "t0k"));

    let missing =
        token_reply(ResponseTemplate::new(404).set_body_json(json!({"error": "not_found"})))
            .await
            .unwrap();
    assert!(matches!(missing, Grant::NotConnected));

    let reauth =
        token_reply(ResponseTemplate::new(409).set_body_json(json!({"error": "needs_reauth"})))
            .await
            .unwrap();
    assert!(matches!(reauth, Grant::NeedsReauth));

    assert!(token_reply(ResponseTemplate::new(503)).await.is_err());
}

#[tokio::test]
async fn connecting_opens_a_dialpad_session_for_the_user() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/connect-sessions"))
        .and(body_json(json!({
            "external_user_id": "macro|ada@example.com",
            "app_id": "dialpad",
            "redirect_url": "https://app.test/back",
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "connect_url": "https://connect.test/s/1",
            "expires_at": "2026-01-01T00:00:00Z",
        })))
        .expect(1)
        .mount(&server)
        .await;

    let url = grants(&server)
        .connect_url(&user(), "https://app.test/back")
        .await
        .unwrap();
    assert_eq!(url, "https://connect.test/s/1");
}

#[tokio::test]
async fn disconnecting_an_absent_connection_succeeds() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/users/macro|ada@example.com/connections/dialpad"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;

    grants(&server).disconnect(&user()).await.unwrap();
}
