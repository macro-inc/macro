use super::*;
use crate::outbound::api::PipedreamConfig;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(server: &MockServer) -> PipedreamClient {
    PipedreamClient::new(PipedreamConfig {
        client_id: "client".into(),
        client_secret: "secret".into(),
        project_id: "proj_123".into(),
        environment: "development".into(),
        allowed_origins: Vec::new(),
        api_url: server.uri(),
        mcp_url: server.uri(),
    })
    .unwrap()
}

fn connection(app_slug: &str) -> PipedreamConnection {
    PipedreamConnection {
        user_id: MacroUserIdStr::parse_from_str("macro|user-1@example.com")
            .unwrap()
            .into_owned(),
        app_slug: app_slug.into(),
        server_name: app_slug.into(),
        account_id: "apn_abc".into(),
        enabled: true,
    }
}

async fn mount_token(server: &MockServer) {
    Mock::given(method("POST"))
        .and(path("/v1/oauth/token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"access_token": "tok", "expires_in": 3600})),
        )
        .expect(1)
        .mount(server)
        .await;
}

#[test]
fn target_urls_are_url_safe_base64_without_padding() {
    let server_uri = "https://api.pipedream.com";
    let client = PipedreamClient::new(PipedreamConfig {
        client_id: String::new(),
        client_secret: String::new(),
        project_id: "proj_123".into(),
        environment: "production".into(),
        allowed_origins: Vec::new(),
        api_url: server_uri.into(),
        mcp_url: server_uri.into(),
    })
    .unwrap();
    // Pipedream's documented example for Linear's GraphQL endpoint.
    assert_eq!(
        client.proxy_url("https://api.linear.app/graphql"),
        "https://api.pipedream.com/v1/connect/proj_123/proxy/aHR0cHM6Ly9hcGkubGluZWFyLmFwcC9ncmFwaHFs"
    );
    assert!(
        !client
            .proxy_url("https://api.notion.com/v1/search?x=1")
            .contains('=')
    );
}

#[tokio::test]
async fn post_forwards_body_and_upstream_headers_as_the_connected_account() {
    let server = MockServer::start().await;
    mount_token(&server).await;
    let target = URL_SAFE_NO_PAD.encode("https://api.notion.com/v1/search");
    Mock::given(method("POST"))
        .and(path(format!("/v1/connect/proj_123/proxy/{target}")))
        .and(query_param("external_user_id", "macro|user-1@example.com"))
        .and(query_param("account_id", "apn_abc"))
        .and(header("authorization", "Bearer tok"))
        .and(header("x-pd-environment", "development"))
        .and(header("x-pd-proxy-notion-version", "2025-09-03"))
        .and(body_json(serde_json::json!({"page_size": 100})))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"results": []})))
        .expect(1)
        .mount(&server)
        .await;

    let response = client(&server)
        .send(
            &connection("notion"),
            ProxyRequest::post_json(
                "https://api.notion.com/v1/search",
                serde_json::json!({"page_size": 100}),
            )
            .header("Notion-Version", "2025-09-03"),
        )
        .await
        .unwrap();

    assert_eq!(response.status, 200);
    assert_eq!(
        response.json::<serde_json::Value>().unwrap(),
        serde_json::json!({"results": []})
    );
}

#[tokio::test]
async fn upstream_rate_limits_are_responses_with_retry_after() {
    let server = MockServer::start().await;
    mount_token(&server).await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "7")
                .set_body_json(serde_json::json!({"code": "rate_limited"})),
        )
        .mount(&server)
        .await;

    let response = client(&server)
        .send(
            &connection("notion"),
            ProxyRequest::get("https://api.notion.com/v1/users/me"),
        )
        .await
        .unwrap();

    assert_eq!(response.status, 429);
    assert!(!response.is_success());
    assert_eq!(response.retry_after, Some(Duration::from_secs(7)));
}
