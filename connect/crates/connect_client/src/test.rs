use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path},
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
                "mcp_url": "https://mcp.notion.com/mcp", "icon_url": null
            }])),
        )
        .mount(&server)
        .await;
    assert_eq!(client.catalog().await.unwrap()[0].id, "notion");

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
