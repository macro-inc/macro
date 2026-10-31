use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path, query_param},
};

#[tokio::test]
async fn calls_every_customer_route_with_the_shared_wire_contract() {
    let server = MockServer::start().await;
    let client =
        ConnectClient::new(&format!("{}/connect", server.uri()), "ck_test_secret").unwrap();
    Mock::given(method("GET"))
        .and(path("/connect/v1/catalog"))
        .and(header("authorization", "Bearer ck_test_secret"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                "id": "notion", "name": "Notion", "description": "Notes", "access": ["mcp"],
                "mcp_url": "https://mcp.notion.com/mcp", "icon_url": null,
                "oauth_client": "dcr"
            }])),
        )
        .mount(&server)
        .await;
    let catalog = client.catalog().await.unwrap();
    assert_eq!(catalog[0].id, "notion");
    assert_eq!(catalog[0].oauth_client, Some(wire::OAuthClient::Dcr));

    Mock::given(method("GET"))
        .and(path("/connect/v1/catalog/notion/icon.svg"))
        .respond_with(ResponseTemplate::new(200).set_body_raw("<svg/>", "image/svg+xml"))
        .mount(&server)
        .await;
    assert_eq!(client.catalog_icon("notion").await.unwrap(), b"<svg/>");

    Mock::given(method("POST"))
        .and(path("/connect/v1/connect-sessions"))
        .and(body_json(serde_json::json!({
            "external_user_id": "user-1", "app_id": "notion", "redirect_url": "https://customer.test/done"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "connect_url": "https://connect.test/v1/connect/session", "expires_at": "2026-10-30T10:00:00Z"
        })))
        .mount(&server).await;
    let session = client
        .create_connect_session("user-1", "notion", "https://customer.test/done")
        .await
        .unwrap();
    assert_eq!(
        session.connect_url,
        "https://connect.test/v1/connect/session"
    );

    Mock::given(method("GET"))
        .and(path("/connect/v1/users/user-1/connections"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                "appId": "notion", "status": "active", "scopes": ["read"],
                "createdAt": "2026-10-30T09:00:00Z"
            }])),
        )
        .mount(&server)
        .await;
    let connections = client.connections("user-1").await.unwrap();
    assert_eq!(connections[0].app_id, "notion");
    assert!(matches!(
        connections[0].status,
        wire::ConnectionStatus::Active
    ));

    Mock::given(method("DELETE"))
        .and(path("/connect/v1/users/user-1/connections/notion"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"vendorGrantRevoked": false})),
        )
        .mount(&server)
        .await;
    assert!(
        !client
            .delete_connection("user-1", "notion")
            .await
            .unwrap()
            .vendor_grant_revoked
    );

    Mock::given(method("GET"))
        .and(path("/connect/v1/users/user-1/connections/notion/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "accessToken": "vendor-secret", "expiresAt": null
        })))
        .mount(&server)
        .await;
    let token = client.access_token("user-1", "notion").await.unwrap();
    assert_eq!(token.access_token, "vendor-secret");
    assert!(!format!("{token:?}").contains("vendor-secret"));

    let upstream = client.mcp_upstream("user-1", "notion");
    assert_eq!(
        upstream.url.as_str(),
        format!("{}/connect/v1/users/user-1/mcp/notion", server.uri())
    );
    assert_eq!(upstream.bearer_token, "ck_test_secret");
    assert!(!format!("{client:?} {upstream:?}").contains("ck_test_secret"));
    assert_eq!(server.received_requests().await.unwrap().len(), 6);
}

#[tokio::test]
async fn lists_customer_pages_and_summary_with_filters() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/v1/connections"))
        .and(header("authorization", "Bearer ck_test_secret"))
        .and(query_param("limit", "1"))
        .and(query_param("app_id", "notion"))
        .and(query_param("status", "active"))
        .respond_with(|request: &wiremock::Request| {
            if request.url.query_pairs().any(|(key, value)| key == "cursor" && value == "next") {
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"items": [{"externalUserId":"second","appId":"notion","status":"active","scopes":[],"createdAt":"2026-10-29T09:00:00Z","updatedAt":"2026-10-29T10:00:00Z","accessTokenExpiresAt":null}],"nextCursor":null}))
            } else {
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"items": [{"externalUserId":"first","appId":"notion","status":"active","scopes":["read"],"createdAt":"2026-10-30T09:00:00Z","updatedAt":"2026-10-30T10:00:00Z","accessTokenExpiresAt":"2026-10-30T11:00:00Z"}],"nextCursor":"next"}))
            }
        }).mount(&server).await;
    Mock::given(method("GET")).and(path("/v1/connections/summary"))
        .and(header("authorization", "Bearer ck_test_secret"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"users":2,"connections":2,"needsReauth":0,"apps":[{"appId":"notion","active":2,"needsReauth":0}]})))
        .mount(&server).await;
    let client = ConnectClient::new(&server.uri(), "ck_test_secret").unwrap();
    let query = wire::ConnectionsQuery {
        limit: Some(1),
        cursor: None,
        app_id: Some("notion".into()),
        status: Some(wire::ConnectionStatus::Active),
    };
    let page = client.list_connections(query.clone()).await.unwrap();
    assert_eq!(page.items[0].external_user_id, "first");
    assert!(page.items[0].access_token_expires_at.is_some());
    assert_eq!(page.next_cursor.as_deref(), Some("next"));
    let all = client.all_connections(query).await.unwrap();
    assert_eq!(
        all.iter()
            .map(|item| item.external_user_id.as_str())
            .collect::<Vec<_>>(),
        ["first", "second"]
    );
    let summary = client.connections_summary().await.unwrap();
    assert_eq!(
        (summary.users, summary.connections, summary.apps[0].active),
        (2, 2, 2)
    );
}

#[tokio::test]
async fn lists_complete_user_pages_with_filters() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/v1/users"))
        .and(header("authorization", "Bearer ck_test_secret"))
        .and(query_param("limit", "1"))
        .and(query_param("app_id", "notion"))
        .and(query_param("status", "active"))
        .respond_with(|request: &wiremock::Request| {
            let (user, cursor) = if request.url.query_pairs().any(|(key, value)| key == "cursor" && value == "next") {
                ("second", serde_json::Value::Null)
            } else {
                ("first", serde_json::json!("next"))
            };
            ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items":[{"externalUserId":user,"firstConnectedAt":"2026-10-30T09:00:00Z","connections":[
                    {"externalUserId":user,"appId":"linear","status":"needs_reauth","scopes":[],"createdAt":"2026-10-29T09:00:00Z","updatedAt":"2026-10-29T10:00:00Z","accessTokenExpiresAt":null},
                    {"externalUserId":user,"appId":"notion","status":"active","scopes":[],"createdAt":"2026-10-30T09:00:00Z","updatedAt":"2026-10-30T10:00:00Z","accessTokenExpiresAt":null}
                ]}],"nextCursor":cursor
            }))
        }).mount(&server).await;
    let client = ConnectClient::new(&server.uri(), "ck_test_secret").unwrap();
    let query = wire::UsersQuery {
        limit: Some(1),
        cursor: None,
        app_id: Some("notion".into()),
        status: Some(wire::ConnectionStatus::Active),
    };
    let first = client.list_users(query.clone()).await.unwrap();
    assert_eq!(first.items.len(), 1);
    assert_eq!(first.items[0].connections.len(), 2);
    assert_eq!(first.next_cursor.as_deref(), Some("next"));
    let all = client.all_users(query).await.unwrap();
    assert_eq!(
        all.iter()
            .map(|user| user.external_user_id.as_str())
            .collect::<Vec<_>>(),
        ["first", "second"]
    );
}

#[tokio::test]
async fn maps_status_and_error_codes_for_callers() {
    for (status, code, expected) in [
        (404, "not_found", "not_connected"),
        (409, "needs_reauth", "needs_reauth"),
        (401, "invalid_key", "unauthorized"),
        (401, "not_found", "unauthorized"),
        (500, "internal_error", "unavailable"),
        (500, "not_found", "unavailable"),
        (503, "internal_error", "unavailable"),
        (400, "invalid_redirect_url", "api"),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/users/user-1/connections"))
            .respond_with(
                ResponseTemplate::new(status).set_body_json(serde_json::json!({"error": code})),
            )
            .mount(&server)
            .await;
        let client = ConnectClient::new(&server.uri(), "ck_test_secret").unwrap();
        let error = client.connections("user-1").await.unwrap_err();
        match expected {
            "not_connected" => assert!(matches!(error, Error::NotConnected)),
            "needs_reauth" => assert!(matches!(error, Error::NeedsReauth)),
            "unauthorized" => assert!(matches!(error, Error::Unauthorized)),
            "unavailable" => assert!(matches!(error, Error::Unavailable)),
            "api" => assert!(
                matches!(error, Error::Api { status: StatusCode::BAD_REQUEST, message } if message == code)
            ),
            _ => unreachable!(),
        }
    }
}

#[tokio::test]
async fn mcp_gateway_path_escapes_customer_identifiers() {
    let client = ConnectClient::new("https://connect.test/connect/", "private-key").unwrap();
    let upstream = client.mcp_upstream("user/one", "notion");
    assert_eq!(
        upstream.url.as_str(),
        "https://connect.test/connect/v1/users/user%2Fone/mcp/notion"
    );
    assert!(!format!("{client:?} {upstream:?}").contains("private-key"));
}
