use super::{AppResponse, PipedreamClient, PipedreamConfig, connectable_catalog_entry};
use crate::domain::models::{MacroUserIdStr, PipedreamConnection};
use crate::domain::ports::ConnectedAppProxy;
use http::{HeaderMap, HeaderValue, Method, StatusCode};
use std::time::Duration;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn app(slug: &str, auth_type: Option<&str>) -> AppResponse {
    AppResponse {
        categories: vec!["Developer Tools".to_owned()],
        name_slug: slug.to_owned(),
        name: slug.to_owned(),
        description: None,
        auth_type: auth_type.map(str::to_owned),
        img_src: "https://assets.pipedream.net/linear.png".to_owned(),
    }
}

#[test]
fn a_matching_slug_with_an_auth_flow_is_connectable() {
    let entry = connectable_catalog_entry("linear", app("linear", Some("oauth"))).expect("app");
    assert_eq!(entry.app_slug, "linear");
    assert_eq!(entry.categories, vec!["Developer Tools"]);
    assert_eq!(
        entry.icon_url.as_deref(),
        Some("https://assets.pipedream.net/linear.png")
    );
}

#[test]
fn an_app_without_an_auth_flow_is_not_connectable() {
    assert!(connectable_catalog_entry("webhook", app("webhook", Some("none"))).is_none());
}

#[test]
fn a_different_slug_than_the_one_asked_for_is_not_that_app() {
    assert!(connectable_catalog_entry("linear", app("slack", Some("oauth"))).is_none());
}

#[test]
fn app_categories_are_optional_for_older_directory_responses() {
    let app: AppResponse = serde_json::from_str(r#"{"name_slug":"linear","name":"Linear"}"#)
        .expect("valid app response");
    assert!(app.categories.is_empty());
}

#[tokio::test]
async fn the_proxy_addresses_the_upstream_url_for_the_connected_account() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/oauth/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"access_token": "project-token", "expires_in": 3600}),
        ))
        .mount(&server)
        .await;
    // base64url (no padding) of https://api.notion.com/v1/search
    Mock::given(method("POST"))
        .and(path(
            "/v1/connect/proj_fixture/proxy/aHR0cHM6Ly9hcGkubm90aW9uLmNvbS92MS9zZWFyY2g",
        ))
        .and(query_param("external_user_id", "macro|caller@example.com"))
        .and(query_param("account_id", "apn_notion"))
        .and(header("authorization", "Bearer project-token"))
        .and(header("x-pd-environment", "development"))
        .and(header("x-pd-proxy-notion-version", "2026-03-11"))
        .and(body_json(serde_json::json!({"page_size": 100})))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "3")
                .set_body_string(r#"{"object":"error","code":"rate_limited"}"#),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = PipedreamClient::new(PipedreamConfig {
        client_id: "fixture".into(),
        client_secret: "fixture".into(),
        project_id: "proj_fixture".into(),
        environment: "development".into(),
        allowed_origins: vec![],
        api_url: server.uri(),
        mcp_url: format!("{}/mcp", server.uri()),
    })
    .unwrap();
    let connection = PipedreamConnection {
        user_id: MacroUserIdStr::try_from_email("caller@example.com").unwrap(),
        app_slug: "notion".into(),
        server_name: "Notion".into(),
        account_id: "apn_notion".into(),
        enabled: true,
    };

    let response = client
        .proxy(
            &connection,
            Method::POST,
            "https://api.notion.com/v1/search",
            &HeaderMap::from_iter([(
                http::HeaderName::from_static("notion-version"),
                HeaderValue::from_static("2026-03-11"),
            )]),
            Some(&serde_json::json!({"page_size": 100})),
        )
        .await
        .unwrap();

    assert_eq!(response.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.retry_after(), Some(Duration::from_secs(3)));
    assert_eq!(response.body, r#"{"object":"error","code":"rate_limited"}"#);
}
