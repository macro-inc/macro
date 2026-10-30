use super::*;
use crate::domain::Repository as _;
use crate::test_support::TestDatabase;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt as _;
use tower::ServiceExt as _;

fn test_router(apps: &'static [App]) -> Router {
    test_router_with_url(apps, "http://localhost:8080")
}

fn test_router_with_url(apps: &'static [App], public_url: &str) -> Router {
    use crate::outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository};
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/connect_test")
        .unwrap();
    let wrapper = Arc::new(LocalKeyWrapper::from_base64(&STANDARD.encode([7_u8; 32])).unwrap());
    let repository = Arc::new(PostgresRepository::new(pool));
    let cipher = Arc::new(EnvelopeCipher::new(wrapper));
    let service = Arc::new(Service::new(repository.clone()));
    let oauth = Arc::new(domain::oauth::OAuthService::new(
        repository,
        cipher,
        Arc::new(outbound::oauth::VendorOAuth::new().unwrap()),
        apps,
        url::Url::parse(public_url).unwrap(),
        HashMap::new(),
    ));
    router(AppState {
        apps,
        service,
        oauth,
        mcp_http: crate::outbound::mcp::VendorMcp::new().unwrap(),
    })
}

#[test]
fn only_live_own_apps_require_credentials() {
    let apps = all_apps().unwrap();
    assert!(load_own_apps(apps, |_| None).unwrap().is_empty());

    let mut github = apps
        .iter()
        .find(|app| app.id.as_str() == "github")
        .unwrap()
        .clone();
    github.status = Status::Live;
    let live = [github];
    assert!(load_own_apps(&live, |_| None).is_err());
    assert!(
        load_own_apps(&live, |key| {
            (key == "GITHUB_CLIENT_ID").then(|| "client".to_owned())
        })
        .is_err()
    );
    let clients = load_own_apps(&live, |key| match key {
        "GITHUB_CLIENT_ID" => Some("client".to_owned()),
        "GITHUB_CLIENT_SECRET" => Some("secret".to_owned()),
        _ => None,
    })
    .unwrap();
    assert_eq!(clients.len(), 1);
    assert!(clients.contains_key("github"));
}

#[test]
fn public_url_accepts_the_gateway_prefix() {
    assert!(parse_public_url("https://dev-gateway.macro.com/connect").is_ok());
    assert!(parse_public_url("http://localhost:8080").is_ok());
    assert!(parse_public_url("https://dev-gateway.macro.com/connect?bad=1").is_err());
    assert!(parse_public_url("https://dev-gateway.macro.com/other").is_err());
}

#[tokio::test]
async fn gateway_prefix_serves_health() {
    let response = test_router(all_apps().unwrap())
        .oneshot(
            Request::builder()
                .uri("/connect/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn gateway_catalog_icon_url_keeps_prefix() {
    let response = test_router_with_url(all_apps().unwrap(), "http://localhost:8080/connect")
        .oneshot(
            Request::builder()
                .uri("/connect/v1/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    let notion = entries
        .iter()
        .find(|entry| entry["id"] == "notion")
        .unwrap();
    assert_eq!(notion["icon_url"], "/connect/v1/catalog/notion/icon.svg");
}

#[tokio::test]
async fn catalog_only_exposes_live_apps_with_public_fields() {
    let apps = all_apps().unwrap();
    let response = test_router(apps)
        .oneshot(
            Request::builder()
                .uri("/v1/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    let live_count = apps.iter().filter(|app| app.status == Status::Live).count();
    assert_eq!(entries.len(), live_count);
    for entry in &entries {
        let id = entry["id"].as_str().unwrap();
        let app = apps.iter().find(|app| app.id.as_str() == id).unwrap();
        assert_eq!(app.status, Status::Live);
        assert_eq!(entry["name"], app.name);
        assert_eq!(entry["description"], app.description);
        assert!(entry["access"].is_array());
        assert_eq!(entry["mcp_url"], app.mcp_url);
        if app.icon_svg.is_some() {
            assert_eq!(entry["icon_url"], format!("/v1/catalog/{id}/icon.svg"));
        } else {
            assert!(entry["icon_url"].is_null());
        }
        assert_eq!(entry.as_object().unwrap().len(), 6);
    }
}

#[tokio::test]
async fn icon_route_returns_embedded_svg_and_404_for_unknown_id() {
    let apps = all_apps().unwrap();
    let response = test_router(apps)
        .oneshot(
            Request::builder()
                .uri("/v1/catalog/notion/icon.svg")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/svg+xml");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let notion = apps.iter().find(|app| app.id.as_str() == "notion").unwrap();
    assert_eq!(bytes.as_ref(), notion.icon_svg.unwrap().as_bytes());

    let response = test_router(apps)
        .oneshot(
            Request::builder()
                .uri("/v1/catalog/unknown/icon.svg")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn openapi_route_describes_catalog() {
    let response = test_router(all_apps().unwrap())
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let schema: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(schema["paths"]["/v1/catalog"]["get"].is_object());
    assert!(schema["paths"]["/v1/users/{external_user_id}/connections"]["get"].is_object());
    assert!(
        schema["paths"]["/v1/users/{external_user_id}/connections/{app_id}"]["delete"].is_object()
    );
    assert!(
        schema["paths"]["/v1/users/{external_user_id}/connections/{app_id}/token"]["get"]
            .is_object()
    );
    for method in ["post", "get", "delete"] {
        assert!(schema["paths"]["/v1/users/{external_user_id}/mcp/{app_id}"][method].is_object());
        assert_eq!(
            schema["paths"]["/v1/users/{external_user_id}/mcp/{app_id}"][method]["security"][0]["customer_key"],
            serde_json::json!([])
        );
    }
    let icon_schema = &schema["components"]["schemas"]["CatalogEntry"]["properties"]["icon_url"];
    assert!(
        icon_schema["type"]
            .as_array()
            .is_some_and(|types| types.contains(&serde_json::json!("null"))),
        "{icon_schema}"
    );
    assert_eq!(
        schema["components"]["securitySchemes"]["customer_key"]["scheme"],
        "bearer"
    );
    assert_eq!(
        schema["paths"]["/v1/users/{external_user_id}/connections"]["get"]["security"][0]["customer_key"],
        serde_json::json!([])
    );
}

#[tokio::test]
#[expect(
    clippy::disallowed_methods,
    reason = "Connect's test database uses its own runtime migration per connect/docs/decisions.md"
)]
async fn routes_enforce_keys_and_customer_scope() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    use crate::{
        domain::{Grant, GrantCipher},
        outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository},
    };
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let repository = Arc::new(PostgresRepository::new(pool.clone()));
    let key = repository.create_customer("Macro").await.unwrap();
    let other_key = repository.create_customer("Other").await.unwrap();
    let customer_id = repository.authenticate(&key).await.unwrap();
    let cipher = Arc::new(EnvelopeCipher::new(Arc::new(
        LocalKeyWrapper::from_base64(&STANDARD.encode([8_u8; 32])).unwrap(),
    )));
    let connection_id = uuid::Uuid::now_v7();
    let grant = Grant {
        access_token: "private-access".into(),
        refresh_token: Some("private-refresh".into()),
        token_type: "Bearer".into(),
        expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
        scopes: vec!["read".into()],
    };
    let envelope = cipher
        .seal(customer_id, connection_id, &grant)
        .await
        .unwrap();
    repository
        .insert_connection(
            connection_id,
            customer_id,
            "user-a",
            "notion",
            &grant.scopes,
            &envelope,
        )
        .await
        .unwrap();
    let app = router(AppState {
        apps: all_apps().unwrap(),
        service: Arc::new(Service::new(repository.clone())),
        oauth: Arc::new(domain::oauth::OAuthService::new(
            repository.clone(),
            cipher,
            Arc::new(outbound::oauth::VendorOAuth::new().unwrap()),
            all_apps().unwrap(),
            url::Url::parse("http://localhost:8080").unwrap(),
            HashMap::new(),
        )),
        mcp_http: crate::outbound::mcp::VendorMcp::new().unwrap(),
    });
    let list = "/v1/users/user-a/connections";
    let request = |uri: &str, key: Option<&str>, method: axum::http::Method| {
        let mut builder = Request::builder().uri(uri).method(method);
        if let Some(key) = key {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {key}"));
        }
        builder.body(Body::empty()).unwrap()
    };
    assert_eq!(
        app.clone()
            .oneshot(request(list, None, axum::http::Method::GET))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.clone()
            .oneshot(request(
                list,
                Some("ck_bad_secret"),
                axum::http::Method::GET
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let revoked_id = uuid::Uuid::parse_str(key.split('_').nth(1).unwrap()).unwrap();
    let wrong_secret = format!("ck_{revoked_id}_wrong-secret");
    assert_eq!(
        app.clone()
            .oneshot(request(list, Some(&wrong_secret), axum::http::Method::GET))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE customer_api_keys SET revoked_at = now() WHERE id = $1")
        .bind(revoked_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(request(list, Some(&key), axum::http::Method::GET))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let response = app
        .clone()
        .oneshot(request(list, Some(&other_key), axum::http::Method::GET))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        0
    );
    // The first customer needs another key after revocation.
    let new_key_id = uuid::Uuid::now_v7();
    let secret = "another-key-secret";
    use sha2::Digest as _;
    let hash = sha2::Sha256::digest(secret.as_bytes());
    sqlx::query(
        "INSERT INTO customer_api_keys (id, customer_id, key_hash, prefix) VALUES ($1, $2, $3, $4)",
    )
    .bind(new_key_id)
    .bind(customer_id)
    .bind(&hash[..])
    .bind(&secret[..8])
    .execute(&pool)
    .await
    .unwrap();
    let owner_key = format!("ck_{new_key_id}_{secret}");
    let response = app
        .clone()
        .oneshot(request(list, Some(&owner_key), axum::http::Method::GET))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()[0]["appId"],
        "notion"
    );
    let token_url = "/v1/users/user-a/connections/notion/token";
    let response = app
        .clone()
        .oneshot(request(
            token_url,
            Some(&owner_key),
            axum::http::Method::GET,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["accessToken"],
        "private-access"
    );
    assert_eq!(
        app.clone()
            .oneshot(request(
                token_url,
                Some(&other_key),
                axum::http::Method::GET
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let delete_url = "/v1/users/user-a/connections/notion";
    assert_eq!(
        app.clone()
            .oneshot(request(
                delete_url,
                Some(&other_key),
                axum::http::Method::DELETE
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let response = app
        .clone()
        .oneshot(request(
            delete_url,
            Some(&owner_key),
            axum::http::Method::DELETE,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["vendorGrantRevoked"],
        false
    );
    assert_eq!(
        app.clone()
            .oneshot(request(
                token_url,
                Some(&owner_key),
                axum::http::Method::GET
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn expired_token_requires_reauthorization() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    use crate::{
        domain::{Grant, GrantCipher},
        outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository},
    };
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let repository = Arc::new(PostgresRepository::new(pool));
    let key = repository.create_customer("Macro").await.unwrap();
    let customer_id = repository.authenticate(&key).await.unwrap();
    let cipher = Arc::new(EnvelopeCipher::new(Arc::new(
        LocalKeyWrapper::from_base64(&STANDARD.encode([8_u8; 32])).unwrap(),
    )));
    let id = uuid::Uuid::now_v7();
    let grant = Grant {
        access_token: "expired".into(),
        refresh_token: None,
        token_type: "Bearer".into(),
        expires_at: Some(chrono::Utc::now() - chrono::Duration::hours(1)),
        scopes: vec![],
    };
    let envelope = cipher.seal(customer_id, id, &grant).await.unwrap();
    repository
        .insert_connection(id, customer_id, "user-a", "notion", &[], &envelope)
        .await
        .unwrap();
    let app = router(AppState {
        apps: all_apps().unwrap(),
        service: Arc::new(Service::new(repository.clone())),
        oauth: Arc::new(domain::oauth::OAuthService::new(
            repository,
            cipher,
            Arc::new(outbound::oauth::VendorOAuth::new().unwrap()),
            all_apps().unwrap(),
            url::Url::parse("http://localhost:8080").unwrap(),
            HashMap::new(),
        )),
        mcp_http: crate::outbound::mcp::VendorMcp::new().unwrap(),
    });
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/users/user-a/connections/notion/token")
                .header(header::AUTHORIZATION, format!("Bearer {}", key.as_str()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
        "needs_reauth"
    );
}
