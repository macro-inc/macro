use super::{AppResponse, connectable_catalog_entry};

fn app(slug: &str, auth_type: Option<&str>) -> AppResponse {
    AppResponse {
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

#[tokio::test]
async fn proxy_routes_the_connected_user_and_preserves_provider_status() {
    use super::{
        ApiProxy, CachedToken, PipedreamClient, PipedreamConfig, PipedreamConnection, ProxyMethod,
    };
    use axum::{
        Router,
        body::Bytes,
        extract::OriginalUri,
        http::{HeaderMap, Method, StatusCode},
        routing::any,
    };
    use base64::Engine;
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    use std::{
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };
    let received = Arc::new(Mutex::new(Vec::new()));
    let requests = received.clone();
    let router = Router::new().fallback(any(
        move |method: Method, uri: OriginalUri, headers: HeaderMap, body: Bytes| {
            let requests = requests.clone();
            async move {
                requests
                    .lock()
                    .unwrap()
                    .push((method, uri.0, headers, body));
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    axum::Json(serde_json::json!({"error":"rate limited"})),
                )
            }
        },
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let client = PipedreamClient::new(PipedreamConfig {
        client_id: "client".into(),
        client_secret: "secret".into(),
        project_id: "proj_test".into(),
        environment: "development".into(),
        allowed_origins: vec![],
        api_url: format!("http://{address}"),
        mcp_url: "https://unused.test".into(),
    })
    .unwrap();
    *client.access_token.lock().unwrap() = Some(CachedToken {
        token: "test-token".into(),
        valid_until: Instant::now() + Duration::from_secs(3600),
    });
    let account = PipedreamConnection {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@test.com")
            .unwrap()
            .into_owned(),
        app_slug: "granola".into(),
        server_name: "Granola".into(),
        account_id: "apn_123".into(),
        enabled: true,
    };
    let target = "https://public-api.granola.ai/v1/webhook-endpoints";
    let body = serde_json::json!({"url":"https://macro.test/webhook"});
    let result = client
        .proxy(&account, ProxyMethod::Post, target, Some(body.clone()))
        .await
        .unwrap();
    assert_eq!(result.status, 429);
    let requests = received.lock().unwrap();
    let (method, uri, headers, bytes) = &requests[0];
    assert_eq!(*method, Method::POST);
    assert_eq!(
        uri.path(),
        format!(
            "/v1/connect/proj_test/proxy/{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(target)
        )
    );
    let query: std::collections::HashMap<_, _> =
        url::form_urlencoded::parse(uri.query().unwrap().as_bytes())
            .into_owned()
            .collect();
    assert_eq!(query["external_user_id"], "macro|owner@test.com");
    assert_eq!(query["account_id"], "apn_123");
    assert_eq!(headers["authorization"], "Bearer test-token");
    assert_eq!(headers["x-pd-environment"], "development");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(bytes).unwrap(),
        body
    );
    server.abort();
}
